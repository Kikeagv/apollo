import { randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { ClinicOwnerInvitationError } from "~/server/application/clinic-owner-invitation-errors";
import { db } from "~/server/db";
import { hashClinicInvitationToken } from "~/server/db/clinic-invitation-token";
import {
  account,
  clinicInvitations,
  clinicUsers,
  configurationAuditEvents,
  doctors,
  identityAuditEvents,
  user,
} from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ClinicInvitationMembership = {
  active: true;
  clinicId: string;
  identityId: string;
  role: "doctor" | "owner";
};

export type ClinicOwnerInvitationActivation = {
  accept(input: {
    password: string;
    token: string;
  }): Promise<ClinicInvitationMembership>;
  recordFailedAttempt(token: string): Promise<void>;
};

export const drizzleClinicOwnerInvitationActivation: ClinicOwnerInvitationActivation =
  {
    async accept(input) {
      const tokenHash = hashClinicInvitationToken(input.token);
      const passwordHash = await hashPassword(input.password);

      try {
        const activation = await db.transaction(async (transaction) => {
          await setInvitationTokenContext(transaction, tokenHash);

          const [invitation] = await transaction
            .update(clinicInvitations)
            .set({ consumedAt: new Date() })
            .where(
              and(
                eq(clinicInvitations.tokenHash, tokenHash),
                isNull(clinicInvitations.consumedAt),
                gt(clinicInvitations.expiresAt, new Date()),
              ),
            )
            .returning({
              clinicId: clinicInvitations.clinicId,
              email: clinicInvitations.email,
              recipientName: clinicInvitations.recipientName,
              role: clinicInvitations.role,
            });

          if (invitation === undefined) {
            await auditFailedActivation(transaction, tokenHash);
            return undefined;
          }

          await setClinicContext(transaction, invitation.clinicId);
          const identityId = randomUUID();
          const now = new Date();

          await transaction.insert(user).values({
            id: identityId,
            name: invitation.recipientName,
            email: invitation.email.toLowerCase(),
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          });
          await transaction.insert(account).values({
            id: randomUUID(),
            accountId: identityId,
            providerId: "credential",
            userId: identityId,
            password: passwordHash,
            createdAt: now,
            updatedAt: now,
          });
          const [clinicUser] = await transaction
            .insert(clinicUsers)
            .values({
              clinicId: invitation.clinicId,
              identityId,
              role: invitation.role,
              active: true,
            })
            .returning({ id: clinicUsers.id });
          if (clinicUser === undefined) {
            throw new Error("No se pudo crear el Usuario de clínica");
          }
          const [doctor] = await transaction
            .insert(doctors)
            .values({
              clinicId: invitation.clinicId,
              clinicUserId: clinicUser.id,
            })
            .returning({ id: doctors.id });
          if (doctor === undefined) {
            throw new Error("No se pudo crear el perfil de Médico propietario");
          }
          await transaction.insert(configurationAuditEvents).values({
            action: "doctor-profile-created",
            actorIdentityId: identityId,
            afterValues: { primarySpecialty: null, publicName: null },
            clinicId: invitation.clinicId,
            entity: "doctor-profile",
            entityId: doctor.id,
          });
          await transaction.insert(identityAuditEvents).values({
            action:
              invitation.role === "owner"
                ? "identity-invitation-accepted"
                : "clinic-doctor-invitation-accepted",
            actorIdentityId: identityId,
            actorKind: "identity",
            clinicId: invitation.clinicId,
            result: "succeeded",
          });

          return {
            active: true as const,
            clinicId: invitation.clinicId,
            identityId,
            role: invitation.role,
          };
        });

        if (activation === undefined) throw new ClinicOwnerInvitationError();
        return activation;
      } catch (error) {
        if (error instanceof ClinicOwnerInvitationError) throw error;
        await this.recordFailedAttempt(input.token);
        throw new ClinicOwnerInvitationError();
      }
    },

    async recordFailedAttempt(token) {
      const tokenHash = hashClinicInvitationToken(token);
      await db.transaction(async (transaction) => {
        await auditFailedActivation(transaction, tokenHash);
      });
    },
  };

async function auditFailedActivation(
  transaction: ClinicTransaction,
  tokenHash: string,
) {
  await setInvitationTokenContext(transaction, tokenHash);
  const invitation = await transaction.query.clinicInvitations.findFirst({
    columns: { clinicId: true },
    where: eq(clinicInvitations.tokenHash, tokenHash),
  });

  if (invitation !== undefined) {
    await setClinicContext(transaction, invitation.clinicId);
  }
  await transaction.insert(identityAuditEvents).values({
    action: "identity-invitation-accepted",
    actorKind: "anonymous",
    clinicId: invitation?.clinicId,
    result: "failed",
  });
}

async function setInvitationTokenContext(
  transaction: ClinicTransaction,
  tokenHash: string,
) {
  await transaction.execute(
    sql`select set_config('app.invitation_token_hash', ${tokenHash}, true)`,
  );
}

async function setClinicContext(
  transaction: ClinicTransaction,
  clinicId: string,
) {
  await transaction.execute(
    sql`select set_config('app.clinic_id', ${clinicId}, true)`,
  );
}
