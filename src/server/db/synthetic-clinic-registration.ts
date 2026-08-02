import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { type SyntheticClinicRegistration } from "~/server/application/create-synthetic-clinic";
import { inSuperadminTransaction } from "~/server/db/clinic-context";
import {
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
        await transaction.insert(clinicInvitations).values({
          clinicId: createdClinic.id,
          email: input.invitation.ownerEmail,
          expiresAt: input.invitation.expiresAt,
          ownerName: input.invitation.ownerName,
          tokenHash: hashInvitationToken(input.invitation.token),
        });
        await transaction.insert(identityAuditEvents).values([
          {
            action: "synthetic-clinic-created",
            actorIdentityId: input.actorIdentityId,
            clinicId: createdClinic.id,
          },
          {
            action: "clinic-owner-invited",
            actorIdentityId: input.actorIdentityId,
            clinicId: createdClinic.id,
          },
        ]);

        return {
          clinic: { ...createdClinic, isSynthetic: true as const },
          invitation: input.invitation,
        };
      },
    );
  },
};

function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
