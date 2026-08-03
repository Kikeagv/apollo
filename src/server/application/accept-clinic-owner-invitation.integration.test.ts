import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { acceptClinicOwnerInvitation } from "./accept-clinic-owner-invitation";
import {
  DoctorProfileAccessError,
  completeOwnDoctorProfile,
  findOwnDoctorProfile,
} from "./doctor-profile";
import { createSyntheticClinic } from "./create-synthetic-clinic";
import { auth } from "../better-auth";
import {
  inClinicTransaction,
  inSuperadminTransaction,
} from "../db/clinic-context";
import { db } from "../db";
import {
  apoloSuperadmins,
  clinics,
  clinicInvitations,
  clinicUsers,
  doctors,
  identityAuditEvents,
  user as identities,
} from "../db/schema";
import { drizzleSyntheticClinicRegistration } from "../db/synthetic-clinic-registration";
import {
  getSentClinicOwnerInvitations,
  sendSimulatedClinicOwnerInvitation,
} from "../email/simulated-identity-email";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("activación persistente por invitación del médico propietario", () => {
  databaseTest(
    "crea una Identidad con Better Auth y una membresía activa al consumir una invitación vigente",
    async () => {
      const fixture = await createActivationFixture();

      try {
        expect(fixture.invitationExpiresAt.getTime()).toBeGreaterThanOrEqual(
          fixture.invitationCreatedAt + 72 * 60 * 60 * 1000,
        );
        expect(fixture.invitationExpiresAt.getTime()).toBeLessThan(
          fixture.invitationCreatedAt + 72 * 60 * 60 * 1000 + 1_000,
        );

        const activation = await acceptClinicOwnerInvitation({
          password: "Contraseña-segura-APO-28",
          token: fixture.invitationToken,
        });

        expect(activation).toMatchObject({
          active: true,
          clinicId: fixture.clinicId,
          role: "owner",
        });
        expect(typeof activation.identityId).toBe("string");
        fixture.identityId = activation.identityId;

        const signedIn = await auth.api.signInEmail({
          body: {
            email: fixture.ownerEmail,
            password: "Contraseña-segura-APO-28",
          },
          headers: new Headers({ origin: "http://localhost:3000" }),
        });
        expect(signedIn.user.id).toBe(activation.identityId);

        const events = await readClinicAuditEvents(
          fixture.superadminId,
          fixture.clinicId,
        );
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: "identity-invitation-accepted",
              actorIdentityId: activation.identityId,
              actorKind: "identity",
              result: "succeeded",
            }),
          ]),
        );
        expectAuditWithoutSensitiveContent(events, "Contraseña-segura-APO-28");
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "crea el perfil del Médico propietario, permite completarlo y deniega a una Secretaria",
    async () => {
      const fixture = await createActivationFixture();
      const additionalDoctorId = `apo-31-doctor-${randomUUID()}`;
      const secretaryId = `apo-31-secretary-${randomUUID()}`;

      try {
        const activation = await acceptClinicOwnerInvitation({
          password: "Contraseña-segura-APO-31",
          token: fixture.invitationToken,
        });
        fixture.identityId = activation.identityId;

        await expect(
          findOwnDoctorProfile({
            clinicId: fixture.clinicId,
            identityId: activation.identityId,
          }),
        ).resolves.toMatchObject({
          primarySpecialty: null,
          publicName: null,
        });

        await expect(
          completeOwnDoctorProfile({
            clinicId: fixture.clinicId,
            identityId: activation.identityId,
            primarySpecialty: "Medicina familiar",
            publicName: "Dra. Ana Reyes",
          }),
        ).resolves.toMatchObject({
          primarySpecialty: "Medicina familiar",
          publicName: "Dra. Ana Reyes",
        });

        await db.insert(identities).values({
          id: additionalDoctorId,
          name: "Dr. Luis Pérez",
          email: `${additionalDoctorId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await inSuperadminTransaction(
          fixture.superadminId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            const [clinicUser] = await transaction
              .insert(clinicUsers)
              .values({
                active: true,
                clinicId: fixture.clinicId,
                identityId: additionalDoctorId,
                role: "doctor",
              })
              .returning({ id: clinicUsers.id });
            if (clinicUser === undefined) throw new Error("Falta el Médico");
            await transaction.insert(doctors).values({
              clinicId: fixture.clinicId,
              clinicUserId: clinicUser.id,
            });
          },
        );
        await expect(
          completeOwnDoctorProfile({
            clinicId: fixture.clinicId,
            identityId: additionalDoctorId,
            primarySpecialty: "Pediatría",
            publicName: "Dr. Luis Pérez",
          }),
        ).resolves.toMatchObject({ primarySpecialty: "Pediatría" });

        await db.insert(identities).values({
          id: secretaryId,
          name: "Secretaria APO-31",
          email: `${secretaryId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await inSuperadminTransaction(
          fixture.superadminId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            await transaction.insert(clinicUsers).values({
              active: true,
              clinicId: fixture.clinicId,
              identityId: secretaryId,
              role: "secretary",
            });
          },
        );

        await expect(
          completeOwnDoctorProfile({
            clinicId: fixture.clinicId,
            identityId: secretaryId,
            primarySpecialty: "No aplica",
            publicName: "Secretaria sin perfil",
          }),
        ).rejects.toBeInstanceOf(DoctorProfileAccessError);

        const audit = await inSuperadminTransaction(
          fixture.superadminId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            return transaction.query.configurationAuditEvents.findMany();
          },
        );
        expect(audit).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: "doctor-profile-created",
              actorIdentityId: activation.identityId,
              afterValues: { primarySpecialty: null, publicName: null },
              clinicId: fixture.clinicId,
              entity: "doctor-profile",
            }),
            expect.objectContaining({
              action: "doctor-profile-completed",
              actorIdentityId: activation.identityId,
              afterValues: {
                primarySpecialty: "Medicina familiar",
                publicName: "Dra. Ana Reyes",
              },
              beforeValues: { primarySpecialty: null, publicName: null },
              clinicId: fixture.clinicId,
              entity: "doctor-profile",
            }),
          ]),
        );
        expect(JSON.stringify(audit)).not.toContain("patient");
      } finally {
        await db
          .delete(identities)
          .where(eq(identities.id, additionalDoctorId));
        await db.delete(identities).where(eq(identities.id, secretaryId));
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "RLS impide que una Clínica consulte o modifique el perfil de Médico de otra",
    async () => {
      const first = await createActivationFixture();
      const second = await createActivationFixture();
      const foreignIdentityId = `apo-31-foreign-doctor-${randomUUID()}`;

      try {
        const firstActivation = await acceptClinicOwnerInvitation({
          password: "Contraseña-segura-APO-31",
          token: first.invitationToken,
        });
        first.identityId = firstActivation.identityId;
        const secondActivation = await acceptClinicOwnerInvitation({
          password: "Contraseña-segura-APO-31",
          token: second.invitationToken,
        });
        second.identityId = secondActivation.identityId;
        const firstProfile = await findOwnDoctorProfile({
          clinicId: first.clinicId,
          identityId: firstActivation.identityId,
        });
        if (firstProfile === undefined)
          throw new Error("Falta el perfil inicial");

        await db.insert(identities).values({
          id: foreignIdentityId,
          name: "Médico ajeno APO-31",
          email: `${foreignIdentityId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const foreignClinicUserId = await inSuperadminTransaction(
          second.superadminId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${second.clinicId}, true)`,
            );
            const [clinicUser] = await transaction
              .insert(clinicUsers)
              .values({
                active: true,
                clinicId: second.clinicId,
                identityId: foreignIdentityId,
                role: "doctor",
              })
              .returning({ id: clinicUsers.id });
            if (clinicUser === undefined) throw new Error("Falta el Médico");
            return clinicUser.id;
          },
        );

        await inClinicTransaction(
          {
            clinicId: second.clinicId,
            identityId: secondActivation.identityId,
          },
          async (transaction) => {
            await expect(
              transaction.query.doctors.findFirst({
                where: eq(doctors.id, firstProfile.id),
              }),
            ).resolves.toBeUndefined();
            await expect(
              transaction
                .update(doctors)
                .set({ publicName: "No debe mutar" })
                .where(eq(doctors.id, firstProfile.id))
                .returning({ id: doctors.id }),
            ).resolves.toEqual([]);
          },
        );
        await expect(
          inClinicTransaction(
            {
              clinicId: first.clinicId,
              identityId: firstActivation.identityId,
            },
            (transaction) =>
              transaction.insert(doctors).values({
                clinicId: first.clinicId,
                clinicUserId: foreignClinicUserId,
              }),
          ),
        ).rejects.toThrow();
      } finally {
        await db.delete(identities).where(eq(identities.id, foreignIdentityId));
        await first.cleanup();
        await second.cleanup();
      }
    },
  );

  databaseTest(
    "rechaza el segundo uso y audita el fallo sin guardar la contraseña",
    async () => {
      const fixture = await createActivationFixture();

      try {
        const activation = await acceptClinicOwnerInvitation({
          password: "Contraseña-segura-APO-28",
          token: fixture.invitationToken,
        });
        fixture.identityId = activation.identityId;

        await expect(
          acceptClinicOwnerInvitation({
            password: "No-debe-quedar-en-la-auditoría",
            token: fixture.invitationToken,
          }),
        ).rejects.toThrow("La invitación no es válida o venció");

        const events = await readClinicAuditEvents(
          fixture.superadminId,
          fixture.clinicId,
        );
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: "identity-invitation-accepted",
              actorKind: "anonymous",
              result: "failed",
            }),
          ]),
        );
        expectAuditWithoutSensitiveContent(
          events,
          "No-debe-quedar-en-la-auditoría",
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "rechaza una invitación vencida y conserva la auditoría sin secretos",
    async () => {
      const fixture = await createActivationFixture();

      try {
        await inSuperadminTransaction(
          fixture.superadminId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            await transaction
              .update(clinicInvitations)
              .set({ expiresAt: new Date(Date.now() - 1) })
              .where(eq(clinicInvitations.clinicId, fixture.clinicId));
          },
        );

        await expect(
          acceptClinicOwnerInvitation({
            password: "Contraseña-vencida-APO-28",
            token: fixture.invitationToken,
          }),
        ).rejects.toThrow("La invitación no es válida o venció");

        const events = await readClinicAuditEvents(
          fixture.superadminId,
          fixture.clinicId,
        );
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: "identity-invitation-accepted",
              actorKind: "anonymous",
              result: "failed",
            }),
          ]),
        );
        expectAuditWithoutSensitiveContent(events, "Contraseña-vencida-APO-28");
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "Better Auth mantiene deshabilitado el registro público",
    async () => {
      const response = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-up/email", {
          body: JSON.stringify({
            email: "registro-publico@example.test",
            name: "Registro público",
            password: "Contraseña-segura-APO-28",
          }),
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          method: "POST",
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.text()).resolves.toContain("not enabled");
    },
  );
});

async function createActivationFixture() {
  const superadminId = `apo-28-superadmin-${randomUUID()}`;
  const ownerEmail = `apo-28-owner-${randomUUID()}@example.test`;
  const invitationCreatedAt = Date.now();
  let identityId: string | undefined;

  await db.insert(identities).values({
    id: superadminId,
    name: "Superadmin sintético APO-28",
    email: `${superadminId}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(apoloSuperadmins).values({ identityId: superadminId });

  const registration = await createSyntheticClinic(
    {
      actorIdentityId: superadminId,
      clinicName: "Clínica Aurora APO-28",
      owner: { email: ownerEmail, name: "Dra. Ana Reyes" },
    },
    {
      registry: drizzleSyntheticClinicRegistration,
      sendOwnerInvitation: sendSimulatedClinicOwnerInvitation,
    },
  );
  const clinicId = registration.id;

  const invitation = await inSuperadminTransaction(
    superadminId,
    async (transaction) => {
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${registration.id}, true)`,
      );
      return transaction.query.clinicInvitations.findFirst({
        where: eq(clinicInvitations.clinicId, registration.id),
      });
    },
  );
  if (invitation === undefined)
    throw new Error("Falta la invitación sintética");

  return {
    clinicId,
    invitationCreatedAt,
    invitationExpiresAt: invitation.expiresAt,
    invitationToken: getInvitationToken(registration.id),
    ownerEmail,
    superadminId,
    get identityId() {
      return identityId;
    },
    set identityId(value: string | undefined) {
      identityId = value;
    },
    async cleanup() {
      if (clinicId !== undefined) {
        await inSuperadminTransaction(superadminId, async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${clinicId}, true)`,
          );
          await transaction
            .delete(identityAuditEvents)
            .where(eq(identityAuditEvents.clinicId, clinicId));
          await transaction.delete(clinics).where(eq(clinics.id, clinicId));
        });
      }
      if (identityId !== undefined) {
        await db.delete(identities).where(eq(identities.id, identityId));
      }
      await db
        .delete(apoloSuperadmins)
        .where(eq(apoloSuperadmins.identityId, superadminId));
      await db.delete(identities).where(eq(identities.id, superadminId));
    },
  };
}

function expectAuditWithoutSensitiveContent(
  events: Awaited<ReturnType<typeof readClinicAuditEvents>>,
  password: string,
) {
  const serialized = JSON.stringify(events);
  const keys = events.flatMap(Object.keys);

  expect(serialized).not.toContain(password);
  expect(keys).not.toContain("password");
  expect(keys).not.toContain("otp");
  expect(keys).not.toContain("patient");
  expect(keys).not.toContain("patientContent");
}

function getInvitationToken(clinicId: string) {
  const invitation = getSentClinicOwnerInvitations()
    .slice()
    .reverse()
    .find((candidate) => candidate.clinicName === "Clínica Aurora APO-28");
  if (invitation === undefined) {
    throw new Error(`Falta el correo simulado de la Clínica ${clinicId}`);
  }
  return invitation.token;
}

async function readClinicAuditEvents(superadminId: string, clinicId: string) {
  return inSuperadminTransaction(superadminId, async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.clinic_id', ${clinicId}, true)`,
    );
    return transaction.query.identityAuditEvents.findMany({
      where: eq(identityAuditEvents.clinicId, clinicId),
    });
  });
}
