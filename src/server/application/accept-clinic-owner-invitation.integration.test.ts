import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { type createTRPCContext } from "~/server/api/trpc";
import { hashOpaqueAccessToken } from "~/server/application/clinic-access";
import { configureEffectiveSchedule } from "./availability";
import { acceptClinicOwnerInvitation } from "./accept-clinic-owner-invitation";
import { calculateCareOptions } from "./care-options";
import { inviteAdditionalDoctor } from "./doctor-invitations";
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
  drizzleAvailabilityStore,
  drizzleCareOptionsStore,
} from "../db/availability-store";
import {
  apoloSuperadmins,
  clinics,
  clinicInvitations,
  clinicUsers,
  clinicSessions,
  doctors,
  identityAuditEvents,
  trustedClinicDevices,
  user as identities,
} from "../db/schema";
import { drizzleSyntheticClinicRegistration } from "../db/synthetic-clinic-registration";
import {
  drizzleDoctorInvitationStore,
  listDoctorInvitationStatuses,
} from "../db/doctor-invitation-store";
import { drizzleServiceCatalogStore } from "../db/service-catalog-store";
import {
  getSentClinicDoctorInvitations,
  getSentClinicOwnerInvitations,
  sendSimulatedClinicDoctorInvitation,
  sendSimulatedClinicOwnerInvitation,
} from "../email/simulated-identity-email";
import { createService } from "./service-catalog";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("activación persistente por invitación del médico propietario", () => {
  databaseTest(
    "la mutación de Panacea adapta la invitación autorizada del propietario",
    async () => {
      const fixture = await createActivationFixture();

      try {
        const owner = await acceptClinicOwnerInvitation({
          password: "Contraseña-segura-APO-32",
          token: fixture.invitationToken,
        });
        fixture.identityId = owner.identityId;
        const trustedDeviceToken = `dispositivo-apo-32-${randomUUID()}`;
        const clinicSessionToken = `sesion-apo-32-${randomUUID()}`;
        await db.insert(trustedClinicDevices).values({
          expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
          identityId: owner.identityId,
          tokenHash: hashOpaqueAccessToken(trustedDeviceToken),
        });
        await db.insert(clinicSessions).values({
          expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
          identityId: owner.identityId,
          tokenHash: hashOpaqueAccessToken(clinicSessionToken),
        });
        const caller = createCaller({
          db,
          headers: new Headers({
            cookie: `panacea-trusted-device=${trustedDeviceToken}; panacea-clinic-session=${clinicSessionToken}`,
          }),
          session: {
            user: { id: owner.identityId },
          } as NonNullable<
            Awaited<ReturnType<typeof createTRPCContext>>["session"]
          >,
        });

        await expect(
          caller.panacea.inviteAdditionalDoctor({
            email: `apo-32-trpc-${randomUUID()}@example.test`,
            name: "Dra. Sofía Molina",
          }),
        ).resolves.toMatchObject({ status: "pending" });
        await expect(caller.panacea.listDoctorInvitations()).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              recipientName: "Dra. Sofía Molina",
              status: "pending",
            }),
          ]),
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "el propietario invita a un Médico, registra el estado y lo activa al aceptar",
    async () => {
      const fixture = await createActivationFixture();
      let doctorIdentityId: string | undefined;

      try {
        const owner = await acceptClinicOwnerInvitation({
          password: "Contraseña-segura-APO-32",
          token: fixture.invitationToken,
        });
        fixture.identityId = owner.identityId;
        const doctorEmail = `apo-32-doctor-${randomUUID()}@example.test`;

        await expect(
          inviteAdditionalDoctor(
            {
              clinicId: fixture.clinicId,
              identityId: owner.identityId,
              recipient: { email: doctorEmail, name: "Dr. Luis Pérez" },
            },
            {
              sendInvitation: (invitation) =>
                sendSimulatedClinicDoctorInvitation({
                  clinicName: invitation.clinicName,
                  expiresAt: invitation.expiresAt,
                  recipientEmail: invitation.email,
                  recipientName: invitation.recipientName,
                  token: invitation.token,
                }),
              store: drizzleDoctorInvitationStore,
            },
          ),
        ).resolves.toMatchObject({
          email: doctorEmail,
          recipientName: "Dr. Luis Pérez",
          status: "pending",
        });

        await expect(
          listDoctorInvitationStatuses({
            clinicId: fixture.clinicId,
            identityId: owner.identityId,
          }),
        ).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ email: doctorEmail, status: "pending" }),
          ]),
        );

        const invitation = getSentClinicDoctorInvitations()
          .slice()
          .reverse()
          .find((candidate) => candidate.recipientEmail === doctorEmail);
        if (invitation === undefined)
          throw new Error("Falta la invitación al Médico");
        const doctor = await acceptClinicOwnerInvitation({
          password: "Contraseña-segura-APO-32",
          token: invitation.token,
        });
        doctorIdentityId = doctor.identityId;

        expect(doctor).toMatchObject({
          active: true,
          clinicId: fixture.clinicId,
          role: "doctor",
        });
        await expect(
          findOwnDoctorProfile({
            clinicId: fixture.clinicId,
            identityId: doctor.identityId,
          }),
        ).resolves.toMatchObject({
          primarySpecialty: null,
          publicName: null,
        });
        await expect(
          listDoctorInvitationStatuses({
            clinicId: fixture.clinicId,
            identityId: owner.identityId,
          }),
        ).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ email: doctorEmail, status: "accepted" }),
          ]),
        );

        const events = await readClinicAuditEvents(
          fixture.superadminId,
          fixture.clinicId,
        );
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ action: "clinic-doctor-invited" }),
            expect.objectContaining({
              action: "clinic-doctor-invitation-accepted",
              actorIdentityId: doctor.identityId,
            }),
          ]),
        );
      } finally {
        if (doctorIdentityId !== undefined) {
          await db
            .delete(identities)
            .where(eq(identities.id, doctorIdentityId));
        }
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "exige perfil público al Médico invitado sin afectar al propietario inicial",
    async () => {
      const fixture = await createActivationFixture();
      let doctorIdentityId: string | undefined;

      try {
        const owner = await acceptClinicOwnerInvitation({
          password: "Contraseña-segura-APO-32",
          token: fixture.invitationToken,
        });
        fixture.identityId = owner.identityId;
        const ownerProfile = await findOwnDoctorProfile({
          clinicId: fixture.clinicId,
          identityId: owner.identityId,
        });
        if (ownerProfile === undefined)
          throw new Error("Falta el perfil del propietario");
        const doctorEmail = `apo-32-agenda-${randomUUID()}@example.test`;
        await inviteAdditionalDoctor(
          {
            clinicId: fixture.clinicId,
            identityId: owner.identityId,
            recipient: { email: doctorEmail, name: "Dr. Rafael Soto" },
          },
          {
            sendInvitation: (invitation) =>
              sendSimulatedClinicDoctorInvitation({
                clinicName: invitation.clinicName,
                expiresAt: invitation.expiresAt,
                recipientEmail: invitation.email,
                recipientName: invitation.recipientName,
                token: invitation.token,
              }),
            store: drizzleDoctorInvitationStore,
          },
        );
        const invitation = getSentClinicDoctorInvitations()
          .slice()
          .reverse()
          .find((candidate) => candidate.recipientEmail === doctorEmail);
        if (invitation === undefined)
          throw new Error("Falta la invitación al Médico");
        const doctor = await acceptClinicOwnerInvitation({
          password: "Contraseña-segura-APO-32",
          token: invitation.token,
        });
        doctorIdentityId = doctor.identityId;
        const doctorProfile = await findOwnDoctorProfile({
          clinicId: fixture.clinicId,
          identityId: doctor.identityId,
        });
        if (doctorProfile === undefined)
          throw new Error("Falta el perfil del Médico");

        expect(ownerProfile).toMatchObject({
          primarySpecialty: null,
          publicName: null,
        });
        expect(doctorProfile).toMatchObject({
          primarySpecialty: null,
          publicName: null,
        });
        const service = await createService(
          {
            clinicId: fixture.clinicId,
            description: "Consulta inicial",
            identityId: owner.identityId,
            name: "Consulta de Agenda",
            offers: [
              {
                bufferMinutes: 0,
                doctorId: ownerProfile.id,
                durationMinutes: 30,
                priceUsd: "35.00",
              },
              {
                bufferMinutes: 0,
                doctorId: doctorProfile.id,
                durationMinutes: 30,
                priceUsd: "35.00",
              },
            ],
          },
          drizzleServiceCatalogStore,
        );
        await configureEffectiveSchedule(
          {
            clinicId: fixture.clinicId,
            doctorId: ownerProfile.id,
            effectiveFrom: "2030-08-01",
            identityId: owner.identityId,
            periods: [{ dayOfWeek: 1, endTime: "09:00", startTime: "08:00" }],
          },
          drizzleAvailabilityStore,
        );
        await configureEffectiveSchedule(
          {
            clinicId: fixture.clinicId,
            doctorId: doctorProfile.id,
            effectiveFrom: "2030-08-01",
            identityId: owner.identityId,
            periods: [{ dayOfWeek: 1, endTime: "09:00", startTime: "08:00" }],
          },
          drizzleAvailabilityStore,
        );

        await expect(
          calculateCareOptions(
            {
              clinicId: fixture.clinicId,
              doctorId: ownerProfile.id,
              from: "2030-08-05",
              identityId: owner.identityId,
              serviceId: service.id,
              to: "2030-08-05",
            },
            drizzleCareOptionsStore,
          ),
        ).resolves.toHaveLength(7);
        await expect(
          calculateCareOptions(
            {
              clinicId: fixture.clinicId,
              doctorId: doctorProfile.id,
              from: "2030-08-05",
              identityId: owner.identityId,
              serviceId: service.id,
              to: "2030-08-05",
            },
            drizzleCareOptionsStore,
          ),
        ).resolves.toEqual([]);
        await completeOwnDoctorProfile({
          clinicId: fixture.clinicId,
          identityId: doctor.identityId,
          primarySpecialty: "Medicina familiar",
          publicName: "Dr. Rafael Soto",
        });
        await expect(
          calculateCareOptions(
            {
              clinicId: fixture.clinicId,
              doctorId: doctorProfile.id,
              from: "2030-08-05",
              identityId: owner.identityId,
              serviceId: service.id,
              to: "2030-08-05",
            },
            drizzleCareOptionsStore,
          ),
        ).resolves.toHaveLength(7);
      } finally {
        if (doctorIdentityId !== undefined) {
          await db
            .delete(identities)
            .where(eq(identities.id, doctorIdentityId));
        }
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "un Médico invitado solo puede consultar y mutar su propio perfil",
    async () => {
      const fixture = await createActivationFixture();
      let doctorIdentityId: string | undefined;

      try {
        const owner = await acceptClinicOwnerInvitation({
          password: "Contraseña-segura-APO-32",
          token: fixture.invitationToken,
        });
        fixture.identityId = owner.identityId;
        const ownerProfile = await findOwnDoctorProfile({
          clinicId: fixture.clinicId,
          identityId: owner.identityId,
        });
        if (ownerProfile === undefined)
          throw new Error("Falta el perfil del propietario");

        const doctorEmail = `apo-32-rls-${randomUUID()}@example.test`;
        await inviteAdditionalDoctor(
          {
            clinicId: fixture.clinicId,
            identityId: owner.identityId,
            recipient: { email: doctorEmail, name: "Dra. Elena García" },
          },
          {
            sendInvitation: (invitation) =>
              sendSimulatedClinicDoctorInvitation({
                clinicName: invitation.clinicName,
                expiresAt: invitation.expiresAt,
                recipientEmail: invitation.email,
                recipientName: invitation.recipientName,
                token: invitation.token,
              }),
            store: drizzleDoctorInvitationStore,
          },
        );
        const invitation = getSentClinicDoctorInvitations().at(-1);
        if (invitation === undefined)
          throw new Error("Falta la invitación al Médico");
        const doctor = await acceptClinicOwnerInvitation({
          password: "Contraseña-segura-APO-32",
          token: invitation.token,
        });
        doctorIdentityId = doctor.identityId;

        await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: doctor.identityId },
          async (transaction) => {
            await expect(
              transaction.query.doctors.findFirst({
                where: eq(doctors.id, ownerProfile.id),
              }),
            ).resolves.toBeUndefined();
            await expect(
              transaction
                .update(doctors)
                .set({ publicName: "No debe mutar" })
                .where(eq(doctors.id, ownerProfile.id))
                .returning({ id: doctors.id }),
            ).resolves.toEqual([]);
          },
        );
      } finally {
        if (doctorIdentityId !== undefined) {
          await db
            .delete(identities)
            .where(eq(identities.id, doctorIdentityId));
        }
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "RLS impide consultar o mutar una invitación de Médico de otra Clínica",
    async () => {
      const first = await createActivationFixture();
      const second = await createActivationFixture();

      try {
        const firstOwner = await acceptClinicOwnerInvitation({
          password: "Contraseña-segura-APO-32",
          token: first.invitationToken,
        });
        first.identityId = firstOwner.identityId;
        const secondOwner = await acceptClinicOwnerInvitation({
          password: "Contraseña-segura-APO-32",
          token: second.invitationToken,
        });
        second.identityId = secondOwner.identityId;
        const invitation = await inviteAdditionalDoctor(
          {
            clinicId: first.clinicId,
            identityId: firstOwner.identityId,
            recipient: {
              email: `apo-32-ajeno-${randomUUID()}@example.test`,
              name: "Dra. Marta López",
            },
          },
          {
            sendInvitation: (doctorInvitation) =>
              sendSimulatedClinicDoctorInvitation({
                clinicName: doctorInvitation.clinicName,
                expiresAt: doctorInvitation.expiresAt,
                recipientEmail: doctorInvitation.email,
                recipientName: doctorInvitation.recipientName,
                token: doctorInvitation.token,
              }),
            store: drizzleDoctorInvitationStore,
          },
        );

        await inClinicTransaction(
          { clinicId: second.clinicId, identityId: secondOwner.identityId },
          async (transaction) => {
            await expect(
              transaction.query.clinicInvitations.findFirst({
                where: eq(clinicInvitations.id, invitation.id),
              }),
            ).resolves.toBeUndefined();
            await expect(
              transaction
                .update(clinicInvitations)
                .set({ consumedAt: new Date() })
                .where(eq(clinicInvitations.id, invitation.id))
                .returning({ id: clinicInvitations.id }),
            ).resolves.toEqual([]);
          },
        );
      } finally {
        await first.cleanup();
        await second.cleanup();
      }
    },
  );

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
