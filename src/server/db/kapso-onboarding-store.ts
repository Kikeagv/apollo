import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { publicWhatsAppConnectionMetadata } from "~/domain/whatsapp-connection";
import type { WhatsAppOwnerAccessStatus } from "~/domain/whatsapp-activation";
import type {
  KapsoWhatsAppOnboardingStore,
  KapsoWhatsAppOnboardingAuditEvent,
  KapsoWhatsAppOnboardingSnapshot,
  KapsoWhatsAppSetupLinkAuditEvent,
} from "~/server/application/kapso-onboarding";
import type {
  KapsoWhatsAppSetupLinkReturnRecord,
  KapsoWhatsAppSetupLinkReturnStore,
} from "~/server/application/whatsapp-setup-link-return";
import { kapsoCreatedPhoneNumberConnectionMissingReason } from "~/domain/whatsapp-kapso-provisioning";
import {
  type ClinicTransaction,
  inClinicTransaction,
  inSuperadminRlsTransaction,
  inSuperadminTransaction,
  inWhatsAppSetupLinkReturnTransaction,
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
  whatsappWebhookEvents,
} from "~/server/db/schema";

export const drizzleKapsoOnboardingStore: KapsoWhatsAppOnboardingStore &
  KapsoWhatsAppSetupLinkReturnStore = {
  async read(input) {
    const operation = async (transaction: ClinicTransaction) => {
      const clinic = await transaction.query.clinics.findFirst({
        columns: { id: true, name: true },
        where: eq(clinics.id, input.clinicId),
      });
      if (clinic === undefined) throw new Error("La Clínica no existe");
      // Las políticas de invitaciones y membresías exigen un contexto de
      // Clínica aun cuando la Identidad de acceso sea superadmin.
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${input.clinicId}, true)`,
      );
      const now = new Date();

      const [
        connection,
        ownerInvitation,
        ownerMembership,
        preflight,
        setupLink,
        setupLinkHistory,
        customerHistory,
      ] = await Promise.all([
        transaction.query.whatsappConnections.findFirst({
          where: eq(whatsappConnections.clinicId, input.clinicId),
        }),
        transaction.query.clinicInvitations.findFirst({
          columns: { recipientName: true },
          where: and(
            eq(clinicInvitations.clinicId, input.clinicId),
            eq(clinicInvitations.role, "owner"),
            isNull(clinicInvitations.consumedAt),
            gt(clinicInvitations.expiresAt, now),
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
              "setup-link-email-failed",
              "setup-link-email-sent",
              "setup-link-provider-unavailable",
              "setup-link-regenerated",
              "setup-link-revoked",
              "setup-link-used",
            ]),
          ),
        }),
        transaction.query.whatsappOnboardingAuditEvents.findFirst({
          columns: { customerId: true },
          orderBy: (events, { desc }) => [desc(events.occurredAt)],
          where: and(
            eq(whatsappOnboardingAuditEvents.clinicId, input.clinicId),
            inArray(whatsappOnboardingAuditEvents.action, [
              "customer-created",
              "customer-confirmed",
            ]),
            eq(whatsappOnboardingAuditEvents.result, "succeeded"),
          ),
        }),
      ]);

      const ownerAccess: WhatsAppOwnerAccessStatus =
        ownerMembership.length > 0
          ? "ready"
          : ownerInvitation === undefined
            ? "blocked"
            : "pending";

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
          (connection?.provider === "kapso" ? connection.customer : null) ??
          setupLink?.customerId ??
          preflight?.customerId ??
          customerHistory?.customerId ??
          null,
        ownerAccess,
        ownerName:
          ownerInvitation?.recipientName ?? ownerMembership[0]?.name ?? null,
        preflight:
          preflight === undefined
            ? null
            : {
                blockers: preflight.blockers,
                checkedAt: preflight.checkedAt,
                checks: preflight.checks ?? null,
                onboardingMode: preflight.onboardingMode,
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
        setupLinkReturn:
          setupLink?.lastReturnStatus === null ||
          setupLink?.lastReturnStatus === undefined ||
          setupLink.lastReturnedAt === null ||
          setupLink.lastReturnedAt === undefined
            ? null
            : {
                errorCode: setupLink.lastReturnErrorCode ?? null,
                returnedAt: setupLink.lastReturnedAt,
                status: setupLink.lastReturnStatus,
              },
      };
    };

    if (input.access === "clinic-owner") {
      return inClinicTransaction(
        { clinicId: input.clinicId, identityId: input.actorIdentityId },
        operation,
      );
    }
    return inSuperadminRlsTransaction(input.actorIdentityId, operation);
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
          realTrafficEnabledAt: null,
          realTrafficEnabledByIdentityId: null,
          realTrafficStatus: "blocked" as const,
          offboardingAuthorizedAt: null,
          offboardingAuthorizedByIdentityId: null,
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
            onboardingMode: input.preflight.onboardingMode ?? "coexistence",
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
              onboardingMode: input.preflight.onboardingMode ?? "coexistence",
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
        const setupLinkReturnValues = {
          ...(input.setupLink.lastReturnErrorCode === undefined
            ? {}
            : { lastReturnErrorCode: input.setupLink.lastReturnErrorCode }),
          ...(input.setupLink.lastReturnStatus === undefined
            ? {}
            : { lastReturnStatus: input.setupLink.lastReturnStatus }),
          ...(input.setupLink.lastReturnedAt === undefined
            ? {}
            : { lastReturnedAt: input.setupLink.lastReturnedAt }),
        };
        await transaction
          .insert(whatsappSetupLinks)
          .values({
            clinicId: input.clinicId,
            customerId: input.customerId,
            kapsoSetupLinkId: input.setupLink.kapsoSetupLinkId,
            url: input.setupLink.url,
            providerError: input.setupLink.providerError,
            providerStatus: input.setupLink.providerStatus,
            ...setupLinkReturnValues,
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
              ...setupLinkReturnValues,
            },
          });
      }

      if (input.auditEvents.length > 0) {
        await transaction
          .insert(whatsappOnboardingAuditEvents)
          .values(input.auditEvents.map((event) => toAuditRow(input, event)));
      }

      const phoneNumberId = input.connection?.phoneNumberId;
      const preflightMode = input.preflight?.onboardingMode ?? "coexistence";
      if (
        input.preflight?.status === "passed" &&
        input.connection?.provider === "kapso" &&
        input.connection.connectionType === preflightMode &&
        input.preflight.checks.numberAssociation === "same-customer" &&
        input.preflight.checks.numberConnectionType === preflightMode &&
        phoneNumberId !== null &&
        phoneNumberId !== undefined &&
        input.customerId !== null
      ) {
        await transaction
          .update(whatsappWebhookEvents)
          .set({
            attempts: 0,
            lastError: null,
            leaseExpiresAt: null,
            leaseToken: null,
            nextAttemptAt: input.preflight.checkedAt,
            processedAt: null,
            rejectedAt: null,
            status: "pending",
          })
          .where(
            and(
              eq(
                whatsappWebhookEvents.eventName,
                "whatsapp.phone_number.created",
              ),
              eq(whatsappWebhookEvents.status, "rejected"),
              eq(
                whatsappWebhookEvents.lastError,
                kapsoCreatedPhoneNumberConnectionMissingReason,
              ),
              sql`${whatsappWebhookEvents.payload}->>'phoneNumberId' = ${phoneNumberId}`,
              sql`${whatsappWebhookEvents.payload}->>'customerId' = ${input.customerId}`,
            ),
          );
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

  async findSetupLinkByProviderId(providerSetupLinkId) {
    return inWhatsAppSetupLinkReturnTransaction(
      providerSetupLinkId,
      async (
        transaction,
      ): Promise<KapsoWhatsAppSetupLinkReturnRecord | undefined> => {
        const setupLink = await transaction.query.whatsappSetupLinks.findFirst({
          columns: {
            clinicId: true,
            customerId: true,
            expiresAt: true,
            kapsoSetupLinkId: true,
            status: true,
          },
          where: eq(whatsappSetupLinks.kapsoSetupLinkId, providerSetupLinkId),
        });
        return setupLink;
      },
    );
  },

  async recordSetupLinkReturn(input) {
    return inWhatsAppSetupLinkReturnTransaction(
      input.setupLinkId,
      async (transaction) => {
        const setupLink = await transaction.query.whatsappSetupLinks.findFirst({
          columns: {
            lastReturnErrorCode: true,
            lastReturnStatus: true,
          },
          where: eq(whatsappSetupLinks.kapsoSetupLinkId, input.setupLinkId),
        });
        if (setupLink === undefined) return false;
        if (
          setupLink.lastReturnStatus === input.status &&
          (setupLink.lastReturnErrorCode ?? null) === input.errorCode
        ) {
          return false;
        }
        await transaction
          .update(whatsappSetupLinks)
          .set({
            lastReturnErrorCode: input.errorCode,
            lastReturnStatus: input.status,
            lastReturnedAt: input.returnedAt,
            updatedAt: input.returnedAt,
          })
          .where(eq(whatsappSetupLinks.kapsoSetupLinkId, input.setupLinkId));
        return true;
      },
    );
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
