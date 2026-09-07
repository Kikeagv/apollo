import { and, eq, inArray, sql } from "drizzle-orm";

import { publicWhatsAppConnectionMetadata } from "~/domain/whatsapp-connection";
import type {
  KapsoWhatsAppOnboardingStore,
  KapsoWhatsAppOnboardingAuditEvent,
  KapsoWhatsAppOnboardingSnapshot,
  KapsoWhatsAppSetupLinkAuditEvent,
} from "~/server/application/kapso-onboarding";
import {
  type ClinicTransaction,
  inClinicTransaction,
  inSuperadminTransaction,
} from "~/server/db/clinic-context";
import {
  clinicInvitations,
  clinicUsers,
  clinics,
  user as identities,
  whatsappConnections,
  whatsappOnboardingAuditEvents,
  whatsappPreflights,
  whatsappSetupLinks,
} from "~/server/db/schema";

export const drizzleKapsoOnboardingStore: KapsoWhatsAppOnboardingStore = {
  async read(input) {
    const operation = async (transaction: ClinicTransaction) => {
      const clinic = await transaction.query.clinics.findFirst({
        columns: { id: true, name: true },
        where: eq(clinics.id, input.clinicId),
      });
      if (clinic === undefined) throw new Error("La Clínica no existe");

      const [
        connection,
        ownerInvitation,
        ownerMembership,
        preflight,
        setupLink,
        setupLinkHistory,
      ] = await Promise.all([
        transaction.query.whatsappConnections.findFirst({
          where: eq(whatsappConnections.clinicId, input.clinicId),
        }),
        transaction.query.clinicInvitations.findFirst({
          columns: { recipientName: true },
          where: and(
            eq(clinicInvitations.clinicId, input.clinicId),
            eq(clinicInvitations.role, "owner"),
          ),
        }),
        transaction
          .select({ name: identities.name })
          .from(clinicUsers)
          .innerJoin(identities, eq(clinicUsers.identityId, identities.id))
          .where(
            and(
              eq(clinicUsers.clinicId, input.clinicId),
              eq(clinicUsers.role, "owner"),
              eq(clinicUsers.active, true),
            ),
          )
          .limit(1),
        transaction.query.whatsappPreflights.findFirst({
          where: eq(whatsappPreflights.clinicId, input.clinicId),
        }),
        transaction.query.whatsappSetupLinks.findFirst({
          where: eq(whatsappSetupLinks.clinicId, input.clinicId),
          orderBy: (links, { desc }) => [desc(links.createdAt)],
        }),
        transaction.query.whatsappOnboardingAuditEvents.findMany({
          columns: {
            action: true,
            actorIdentityId: true,
            occurredAt: true,
            reason: true,
            result: true,
            setupLinkId: true,
          },
          limit: 10,
          orderBy: (events, { desc }) => [desc(events.occurredAt)],
          where: and(
            eq(whatsappOnboardingAuditEvents.clinicId, input.clinicId),
            inArray(whatsappOnboardingAuditEvents.action, [
              "setup-link-confirmed",
              "setup-link-created",
              "setup-link-expired",
              "setup-link-provider-unavailable",
              "setup-link-regenerated",
              "setup-link-revoked",
              "setup-link-used",
            ]),
          ),
        }),
      ]);

      return {
        clinicId: clinic.id,
        clinicName: clinic.name,
        connection:
          connection === undefined
            ? null
            : {
                ...connection,
                metadata: publicWhatsAppConnectionMetadata(connection.metadata),
              },
        customerId:
          preflight?.customerId ??
          (connection?.provider === "kapso" ? connection.customer : null),
        ownerName:
          ownerInvitation?.recipientName ?? ownerMembership[0]?.name ?? null,
        preflight:
          preflight === undefined
            ? null
            : {
                blockers: preflight.blockers,
                checkedAt: preflight.checkedAt,
                checks: preflight.checks ?? null,
                nextAction: preflight.nextAction,
                reason: preflight.reason,
                status: preflight.status,
              },
        setupLink:
          setupLink === undefined
            ? null
            : {
                clinicId: setupLink.clinicId,
                createdAt: setupLink.createdAt,
                expiresAt: setupLink.expiresAt,
                id: setupLink.id,
                revokedAt: setupLink.revokedAt,
                status: setupLink.status,
                updatedAt: setupLink.updatedAt,
                url: setupLink.url,
                usedAt: setupLink.usedAt,
              },
        setupLinkProviderId: setupLink?.kapsoSetupLinkId ?? null,
        setupLinkProviderError: setupLink?.providerError ?? null,
        setupLinkHistory: setupLinkHistory.filter((event) =>
          isSetupLinkAuditEvent(event),
        ),
        setupLinkProviderStatus:
          setupLink?.providerStatus === null ||
          setupLink?.providerStatus === undefined
            ? null
            : (setupLink.providerStatus as NonNullable<
                KapsoWhatsAppOnboardingSnapshot["setupLinkProviderStatus"]
              >),
      };
    };

    if (input.access === "clinic-owner") {
      return inClinicTransaction(
        { clinicId: input.clinicId, identityId: input.actorIdentityId },
        operation,
      );
    }
    return inSuperadminTransaction(input.actorIdentityId, operation);
  },

  async save(input) {
    const operation = async (transaction: ClinicTransaction) => {
      const clinic = await transaction.query.clinics.findFirst({
        columns: { id: true, subscriptionStatus: true },
        where: eq(clinics.id, input.clinicId),
      });
      if (clinic === undefined) throw new Error("La Clínica no existe");

      await transaction.execute(
        sql`select set_config('app.clinic_id', ${input.clinicId}, true)`,
      );
      await transaction.execute(
        sql`select set_config('app.subscription_status', ${clinic.subscriptionStatus}, true)`,
      );

      if (input.connection !== undefined) {
        if (input.customerId === null) {
          throw new Error(
            "Kapso requiere un customer para guardar la conexión",
          );
        }
        const currentConnection =
          await transaction.query.whatsappConnections.findFirst({
            columns: { clinicId: true },
            where: eq(whatsappConnections.clinicId, input.clinicId),
          });
        const connectionValues = {
          connectionType: input.connection.connectionType,
          customer: input.customerId,
          lastTestAt: null,
          metadata: input.connection.metadata,
          phoneNumberE164: input.connection.phoneNumberE164,
          phoneNumberId: input.connection.phoneNumberId,
          provider: input.connection.provider,
          status: input.connection.status,
          updatedAt: new Date(),
        };
        if (currentConnection === undefined) {
          await transaction.insert(whatsappConnections).values({
            clinicId: input.clinicId,
            ...connectionValues,
          });
        } else {
          await transaction
            .update(whatsappConnections)
            .set(connectionValues)
            .where(eq(whatsappConnections.clinicId, input.clinicId));
        }
      }

      if (input.preflight !== undefined) {
        await transaction
          .insert(whatsappPreflights)
          .values({
            checkedAt: input.preflight.checkedAt,
            checks: input.preflight.checks,
            clinicId: input.clinicId,
            customerId: input.customerId,
            blockers: input.preflight.blockers,
            nextAction: input.preflight.nextAction,
            reason: input.preflight.reason,
            status: input.preflight.status,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: whatsappPreflights.clinicId,
            set: {
              checkedAt: input.preflight.checkedAt,
              checks: input.preflight.checks,
              customerId: input.customerId,
              blockers: input.preflight.blockers,
              nextAction: input.preflight.nextAction,
              reason: input.preflight.reason,
              status: input.preflight.status,
              updatedAt: new Date(),
            },
          });
      }

      if (input.setupLink !== undefined) {
        if (input.customerId === null) {
          throw new Error(
            "Kapso requiere un customer para guardar el enlace de configuración",
          );
        }
        await transaction
          .insert(whatsappSetupLinks)
          .values({
            clinicId: input.clinicId,
            customerId: input.customerId,
            kapsoSetupLinkId: input.setupLink.kapsoSetupLinkId,
            url: input.setupLink.url,
            providerError: input.setupLink.providerError,
            providerStatus: input.setupLink.providerStatus,
            status: input.setupLink.status,
            createdAt: input.setupLink.createdAt,
            expiresAt: input.setupLink.expiresAt,
            revokedAt: input.setupLink.revokedAt,
            usedAt: input.setupLink.usedAt,
            createdByIdentityId: input.actorIdentityId,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: whatsappSetupLinks.kapsoSetupLinkId,
            set: {
              customerId: input.customerId,
              providerError: input.setupLink.providerError,
              providerStatus: input.setupLink.providerStatus,
              url: input.setupLink.url,
              status: input.setupLink.status,
              expiresAt: input.setupLink.expiresAt,
              revokedAt: input.setupLink.revokedAt,
              usedAt: input.setupLink.usedAt,
              updatedAt: new Date(),
            },
          });
      }

      if (input.auditEvents.length > 0) {
        await transaction
          .insert(whatsappOnboardingAuditEvents)
          .values(input.auditEvents.map((event) => toAuditRow(input, event)));
      }
    };

    if (input.access === "clinic-owner") {
      await inClinicTransaction(
        { clinicId: input.clinicId, identityId: input.actorIdentityId },
        operation,
      );
      return;
    }
    await inSuperadminTransaction(input.actorIdentityId, operation);
  },
};

function toAuditRow(
  input: {
    actorIdentityId: string;
    clinicId: string;
  },
  event: KapsoWhatsAppOnboardingAuditEvent,
) {
  return {
    action: event.action,
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    customerId: event.customerId,
    reason: event.reason,
    result: event.result,
    setupLinkId: event.setupLinkId ?? null,
  };
}

function isSetupLinkAuditEvent(event: {
  action: string;
}): event is KapsoWhatsAppSetupLinkAuditEvent {
  return event.action.startsWith("setup-link-");
}
