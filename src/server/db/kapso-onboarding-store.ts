import { and, eq, sql } from "drizzle-orm";

import { publicWhatsAppConnectionMetadata } from "~/domain/whatsapp-connection";
import type {
  KapsoWhatsAppOnboardingStore,
  KapsoWhatsAppOnboardingAuditEvent,
} from "~/server/application/kapso-onboarding";
import { inSuperadminTransaction } from "~/server/db/clinic-context";
import {
  clinicInvitations,
  clinicUsers,
  clinics,
  user as identities,
  whatsappConnections,
  whatsappOnboardingAuditEvents,
  whatsappPreflights,
} from "~/server/db/schema";

export const drizzleKapsoOnboardingStore: KapsoWhatsAppOnboardingStore = {
  async read(input) {
    return inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        const clinic = await transaction.query.clinics.findFirst({
          columns: { id: true, name: true },
          where: eq(clinics.id, input.clinicId),
        });
        if (clinic === undefined) throw new Error("La Clínica no existe");

        const [connection, ownerInvitation, ownerMembership, preflight] =
          await Promise.all([
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
          ]);

        return {
          clinicId: clinic.id,
          clinicName: clinic.name,
          connection:
            connection === undefined
              ? null
              : {
                  ...connection,
                  metadata: publicWhatsAppConnectionMetadata(
                    connection.metadata,
                  ),
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
        };
      },
    );
  },

  async save(input) {
    await inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
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

        await transaction
          .insert(whatsappOnboardingAuditEvents)
          .values(input.auditEvents.map((event) => toAuditRow(input, event)));
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
  };
}
