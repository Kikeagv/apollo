import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { acceptClinicOwnerInvitation } from "./accept-clinic-owner-invitation";
import { createSyntheticClinic } from "./create-synthetic-clinic";
import { auth } from "../better-auth";
import { inSuperadminTransaction } from "../db/clinic-context";
import { db } from "../db";
import {
  apoloSuperadmins,
  clinics,
  clinicInvitations,
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
