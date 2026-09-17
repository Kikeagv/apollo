import { randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type {
  ClinicInvitationAcceptance,
  ClinicInvitationActivationMode,
} from "~/domain/clinic-invitation";
import { ClinicOwnerInvitationError } from "~/server/application/clinic-owner-invitation-errors";
import { db } from "~/server/db";
import { hashClinicInvitationToken } from "~/server/db/clinic-invitation-token";
import {
  account,
  clinicInvitations,
  clinics,
  clinicUsers,
  configurationAuditEvents,
  doctors,
  identityAuditEvents,
  user,
} from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ClinicInvitationMembership = ClinicInvitationAcceptance;

export type ClinicOwnerInvitationActivation = {
  accept(input: {
    password?: string;
    token: string;
  }): Promise<ClinicInvitationMembership>;
  recordFailedAttempt(token: string): Promise<void>;
};

export type ClinicOwnerInvitationPreflight = {
  preflight(token: string): Promise<ClinicInvitationActivationMode>;
};

class ExistingIdentityClinicConflictError extends Error {
  readonly result: ClinicInvitationMembership;

  constructor(input: { clinicId: string; role: "doctor" | "owner" }) {
    super("La Identidad ya tiene acceso a otra Clínica");
    this.name = "ExistingIdentityClinicConflictError";
    this.result = {
      active: false,
      clinicId: input.clinicId,
      identityStatus: "existing",
      invitationStatus: "requires-support",
      nextAction: "contact-support",
      role: input.role,
    };
  }
}

export const drizzleClinicOwnerInvitationActivation: ClinicOwnerInvitationActivation &
  ClinicOwnerInvitationPreflight = {
  async preflight(token) {
    const tokenHash = hashClinicInvitationToken(token);
    try {
      return await db.transaction(async (transaction) => {
        await transaction.execute(sql`set local role panacea_clinical_access`);
        await setInvitationTokenContext(transaction, tokenHash);
        const invitation = await transaction.query.clinicInvitations.findFirst({
          columns: {
            consumedAt: true,
            email: true,
            expiresAt: true,
          },
          where: eq(clinicInvitations.tokenHash, tokenHash),
        });
        if (invitation === undefined) throw new ClinicOwnerInvitationError();
        if (
          invitation.consumedAt === null &&
          invitation.expiresAt <= new Date()
        ) {
          throw new ClinicOwnerInvitationError();
        }
        if (invitation.consumedAt !== null) return "accepted";

        await lockInvitationIdentity(transaction, invitation.email);
        const existingIdentity = await transaction.query.user.findFirst({
          columns: { id: true },
          where: sql`lower(${user.email}) = lower(${invitation.email})`,
        });
        return existingIdentity === undefined ? "new" : "existing";
      });
    } catch (error) {
      if (error instanceof ClinicOwnerInvitationError) throw error;
      throw new ClinicOwnerInvitationError();
    }
  },
  async accept(input) {
    const tokenHash = hashClinicInvitationToken(input.token);

    try {
      const activation = await db.transaction(async (transaction) => {
        await transaction.execute(sql`set local role panacea_clinical_access`);
        await setInvitationTokenContext(transaction, tokenHash);
        const invitationContext =
          await transaction.query.clinicInvitations.findFirst({
            columns: { clinicId: true },
            where: eq(clinicInvitations.tokenHash, tokenHash),
          });
        if (invitationContext !== undefined) {
          await setClinicContext(transaction, invitationContext.clinicId);
        }

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
            id: clinicInvitations.id,
            recipientName: clinicInvitations.recipientName,
            role: clinicInvitations.role,
            acceptedIdentityCreated: clinicInvitations.acceptedIdentityCreated,
            acceptedIdentityId: clinicInvitations.acceptedIdentityId,
          });

        if (invitation === undefined) {
          const repeated = await resolveAlreadyAcceptedInvitation(
            transaction,
            tokenHash,
          );
          if (repeated !== undefined) return repeated;
          await auditFailedActivation(transaction, tokenHash);
          return undefined;
        }

        await setClinicContext(transaction, invitation.clinicId);
        await setClinicRole(transaction, "owner");
        await lockInvitationIdentity(transaction, invitation.email);
        const existingIdentity = await transaction.query.user.findFirst({
          columns: { id: true },
          where: sql`lower(${user.email}) = lower(${invitation.email})`,
        });
        if (existingIdentity !== undefined) {
          return activateExistingIdentity(transaction, invitation, tokenHash, {
            identityId: existingIdentity.id,
          });
        }

        if (input.password === undefined) {
          throw new Error("La nueva Identidad requiere una contraseña");
        }
        const passwordHash = await hashPassword(input.password);

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
        const [acceptedInvitation] = await transaction
          .update(clinicInvitations)
          .set({
            acceptedIdentityCreated: true,
            acceptedIdentityId: identityId,
          })
          .where(
            and(
              eq(clinicInvitations.id, invitation.id),
              eq(clinicInvitations.tokenHash, tokenHash),
            ),
          )
          .returning({ id: clinicInvitations.id });
        if (acceptedInvitation === undefined) {
          throw new Error("No se pudo guardar la aceptación");
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
          identityStatus: "created" as const,
          invitationStatus: "accepted" as const,
          role: invitation.role,
        };
      });

      if (activation === undefined) throw new ClinicOwnerInvitationError();
      return activation;
    } catch (error) {
      if (error instanceof ExistingIdentityClinicConflictError) {
        await this.recordFailedAttempt(input.token);
        return error.result;
      }
      if (error instanceof ClinicOwnerInvitationError) throw error;
      await this.recordFailedAttempt(input.token);
      throw new ClinicOwnerInvitationError();
    }
  },

  async recordFailedAttempt(token) {
    const tokenHash = hashClinicInvitationToken(token);
    await db.transaction(async (transaction) => {
      await transaction.execute(sql`set local role panacea_clinical_access`);
      await auditFailedActivation(transaction, tokenHash);
    });
  },
};

async function activateExistingIdentity(
  transaction: ClinicTransaction,
  invitation: {
    clinicId: string;
    email: string;
    id: string;
    recipientName: string;
    role: "doctor" | "owner";
  },
  tokenHash: string,
  input: { identityId: string },
): Promise<ClinicInvitationMembership> {
  await setIdentityContext(transaction, input.identityId);
  const memberships = await transaction.query.clinicUsers.findMany({
    columns: { active: true, clinicId: true, id: true, role: true },
    where: eq(clinicUsers.identityId, input.identityId),
  });
  const activeOtherClinic = memberships.find(
    (membership) =>
      membership.active && membership.clinicId !== invitation.clinicId,
  );
  if (activeOtherClinic !== undefined) {
    throw new ExistingIdentityClinicConflictError({
      clinicId: invitation.clinicId,
      role: invitation.role,
    });
  }

  let membership = memberships.find(
    (candidate) => candidate.clinicId === invitation.clinicId,
  );
  if (membership !== undefined) {
    if (!membership.active || membership.role !== invitation.role) {
      throw new Error("El acceso existente no coincide con la invitación");
    }
    await setClinicUserContext(transaction, membership.id);
  } else {
    const [createdMembership] = await transaction
      .insert(clinicUsers)
      .values({
        clinicId: invitation.clinicId,
        identityId: input.identityId,
        role: invitation.role,
        active: true,
      })
      .returning({
        id: clinicUsers.id,
        role: clinicUsers.role,
      });
    if (createdMembership === undefined) {
      throw new Error("No se pudo crear el Usuario de clínica");
    }
    membership = {
      active: true,
      clinicId: invitation.clinicId,
      id: createdMembership.id,
      role: createdMembership.role,
    };
    await setClinicUserContext(transaction, membership.id);
  }

  const doctor = await transaction.query.doctors.findFirst({
    columns: { id: true },
    where: and(
      eq(doctors.clinicId, invitation.clinicId),
      eq(doctors.clinicUserId, membership.id),
    ),
  });
  if (doctor === undefined) {
    const [createdDoctor] = await transaction
      .insert(doctors)
      .values({
        clinicId: invitation.clinicId,
        clinicUserId: membership.id,
      })
      .returning({ id: doctors.id });
    if (createdDoctor === undefined) {
      throw new Error("No se pudo crear el perfil de Médico propietario");
    }
    await transaction.insert(configurationAuditEvents).values({
      action: "doctor-profile-created",
      actorIdentityId: input.identityId,
      afterValues: { primarySpecialty: null, publicName: null },
      clinicId: invitation.clinicId,
      entity: "doctor-profile",
      entityId: createdDoctor.id,
    });
  }

  const [acceptedInvitation] = await transaction
    .update(clinicInvitations)
    .set({
      acceptedIdentityCreated: false,
      acceptedIdentityId: input.identityId,
    })
    .where(
      and(
        eq(clinicInvitations.id, invitation.id),
        eq(clinicInvitations.tokenHash, tokenHash),
      ),
    )
    .returning({ id: clinicInvitations.id });
  if (acceptedInvitation === undefined) {
    throw new Error("No se pudo guardar la aceptación");
  }
  await transaction.insert(identityAuditEvents).values({
    action:
      invitation.role === "owner"
        ? "identity-invitation-accepted"
        : "clinic-doctor-invitation-accepted",
    actorIdentityId: input.identityId,
    actorKind: "identity",
    clinicId: invitation.clinicId,
    result: "succeeded",
  });

  return {
    active: true,
    clinicId: invitation.clinicId,
    identityId: input.identityId,
    identityStatus: "existing",
    invitationStatus: "accepted",
    role: invitation.role,
  };
}

async function resolveAlreadyAcceptedInvitation(
  transaction: ClinicTransaction,
  tokenHash: string,
): Promise<ClinicInvitationMembership | undefined> {
  const invitation = await transaction.query.clinicInvitations.findFirst({
    columns: {
      acceptedIdentityCreated: true,
      acceptedIdentityId: true,
      clinicId: true,
      consumedAt: true,
      email: true,
      id: true,
      role: true,
    },
    where: eq(clinicInvitations.tokenHash, tokenHash),
  });
  if (invitation === undefined) return undefined;
  if (invitation.consumedAt === null) return undefined;

  let identityId = invitation.acceptedIdentityId;
  let identityStatus =
    invitation.acceptedIdentityCreated === true
      ? ("created" as const)
      : ("existing" as const);
  if (identityId === null) {
    const identity = await transaction.query.user.findFirst({
      columns: { id: true },
      where: sql`lower(${user.email}) = lower(${invitation.email})`,
    });
    if (identity === undefined) return undefined;
    identityId = identity.id;
  }

  await setClinicContext(transaction, invitation.clinicId);
  await setIdentityContext(transaction, identityId);
  const membership = await transaction.query.clinicUsers.findFirst({
    columns: { id: true },
    where: and(
      eq(clinicUsers.clinicId, invitation.clinicId),
      eq(clinicUsers.identityId, identityId),
      eq(clinicUsers.role, invitation.role),
      eq(clinicUsers.active, true),
    ),
  });
  if (membership === undefined) return undefined;

  if (invitation.acceptedIdentityId === null) {
    const [backfilledInvitation] = await transaction
      .update(clinicInvitations)
      .set({
        acceptedIdentityCreated: identityStatus === "created",
        acceptedIdentityId: identityId,
      })
      .where(
        and(
          eq(clinicInvitations.id, invitation.id),
          eq(clinicInvitations.tokenHash, tokenHash),
        ),
      )
      .returning({ id: clinicInvitations.id });
    if (backfilledInvitation === undefined) {
      throw new Error("No se pudo guardar la aceptación histórica");
    }
    identityStatus = "existing";
  }

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
    active: true,
    clinicId: invitation.clinicId,
    identityId,
    identityStatus,
    invitationStatus: "already-accepted",
    role: invitation.role,
  };
}

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

async function lockInvitationIdentity(
  transaction: ClinicTransaction,
  email: string,
) {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext(${"clinic-invitation:" + email.toLowerCase()}))`,
  );
}

async function setIdentityContext(
  transaction: ClinicTransaction,
  identityId: string,
) {
  await transaction.execute(
    sql`select set_config('app.identity_id', ${identityId}, true)`,
  );
}

async function setClinicUserContext(
  transaction: ClinicTransaction,
  clinicUserId: string,
) {
  await transaction.execute(
    sql`select set_config('app.clinic_user_id', ${clinicUserId}, true)`,
  );
}

async function setClinicRole(
  transaction: ClinicTransaction,
  role: "owner" | "doctor",
) {
  await transaction.execute(
    sql`select set_config('app.clinic_role', ${role}, true)`,
  );
}

async function setClinicContext(
  transaction: ClinicTransaction,
  clinicId: string,
) {
  await transaction.execute(
    sql`select set_config('app.clinic_id', ${clinicId}, true)`,
  );
  const clinic = await transaction.query.clinics.findFirst({
    columns: { subscriptionStatus: true },
    where: eq(clinics.id, clinicId),
  });
  if (clinic === undefined) throw new Error("La Clínica no existe");
  await transaction.execute(
    sql`select set_config('app.subscription_status', ${clinic.subscriptionStatus}, true)`,
  );
}
