import { randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { type ClinicOwnerMembership } from "~/server/application/accept-clinic-owner-invitation";
import { ClinicOwnerInvitationError } from "~/server/application/clinic-owner-invitation-errors";
import { db } from "~/server/db";
import { hashClinicOwnerInvitationToken } from "~/server/db/clinic-owner-invitation-token";
import {
  account,
  clinicInvitations,
  clinicUsers,
  identityAuditEvents,
  user,
} from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ClinicOwnerInvitationActivation = {
  accept(input: {
    password: string;
    token: string;
  }): Promise<ClinicOwnerMembership>;
  recordFailedAttempt(token: string): Promise<void>;
};

export const drizzleClinicOwnerInvitationActivation: ClinicOwnerInvitationActivation =
  {
    async accept(input) {
      const tokenHash = hashClinicOwnerInvitationToken(input.token);
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
              ownerName: clinicInvitations.ownerName,
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
            name: invitation.ownerName,
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
          await transaction.insert(clinicUsers).values({
            clinicId: invitation.clinicId,
            identityId,
            role: "owner",
            active: true,
          });
          await transaction.insert(identityAuditEvents).values({
            action: "identity-invitation-accepted",
            actorIdentityId: identityId,
            actorKind: "identity",
            clinicId: invitation.clinicId,
            result: "succeeded",
          });

          return {
            active: true as const,
            clinicId: invitation.clinicId,
            identityId,
            role: "owner" as const,
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
      const tokenHash = hashClinicOwnerInvitationToken(token);
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
