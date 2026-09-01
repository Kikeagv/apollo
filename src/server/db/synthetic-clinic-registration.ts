import { sql } from "drizzle-orm";

import { type SyntheticClinicRegistration } from "~/server/application/create-synthetic-clinic";
import { inSuperadminTransaction } from "~/server/db/clinic-context";
import { hashClinicInvitationToken } from "~/server/db/clinic-invitation-token";
import {
  clinicReadiness,
  clinics,
  clinicInvitations,
  identityAuditEvents,
} from "~/server/db/schema";

export const drizzleSyntheticClinicRegistration: SyntheticClinicRegistration = {
  async register(input) {
    return inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        const [createdClinic] = await transaction
          .insert(clinics)
          .values({ isSynthetic: true, name: input.clinicName })
          .returning({ id: clinics.id, name: clinics.name });
        if (createdClinic === undefined) {
          throw new Error("No se pudo crear la Clínica sintética");
        }

        await transaction.execute(
          sql`select set_config('app.clinic_id', ${createdClinic.id}, true)`,
        );
        await transaction.execute(
          sql`select set_config('app.subscription_status', 'active', true)`,
        );
        await transaction.insert(clinicReadiness).values({
          clinicId: createdClinic.id,
        });
        await transaction.insert(clinicInvitations).values({
          clinicId: createdClinic.id,
          email: input.invitation.ownerEmail,
          expiresAt: input.invitation.expiresAt,
          recipientName: input.invitation.ownerName,
          tokenHash: hashClinicInvitationToken(input.invitation.token),
        });
        await transaction.insert(identityAuditEvents).values({
          action: "synthetic-clinic-created",
          actorIdentityId: input.actorIdentityId,
          actorKind: "identity",
          clinicId: createdClinic.id,
          result: "succeeded",
        });

        return {
          clinic: { ...createdClinic, isSynthetic: true as const },
          invitation: input.invitation,
        };
      },
    );
  },

  async recordInvitationDelivery(input) {
    await inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        await transaction.execute(
          sql`select set_config('app.clinic_id', ${input.clinicId}, true)`,
        );
        await transaction.execute(
          sql`select set_config('app.subscription_status', 'active', true)`,
        );
        await transaction.insert(identityAuditEvents).values({
          action: "clinic-owner-invited",
          actorIdentityId: input.actorIdentityId,
          actorKind: "identity",
          clinicId: input.clinicId,
          result: input.result,
        });
      },
    );
  },
};
