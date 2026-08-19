import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { POST as signIn } from "~/app/api/clinic-access/sign-in/route";
import { acceptClinicOwnerInvitation } from "~/server/application/accept-clinic-owner-invitation";
import { createSyntheticClinic } from "~/server/application/create-synthetic-clinic";
import { db } from "~/server/db";
import { inSuperadminTransaction } from "~/server/db/clinic-context";
import { drizzleIdentityPasswordBlockStore } from "~/server/db/identity-password-block-store";
import {
  apoloSuperadmins,
  clinics,
  identityAuditEvents,
  identityLoginFailures,
  user as identities,
} from "~/server/db/schema";
import { drizzleSyntheticClinicRegistration } from "~/server/db/synthetic-clinic-registration";
import {
  getSentClinicOwnerInvitations,
  getSentIdentityPasswordBlockNotices,
  sendSimulatedClinicOwnerInvitation,
} from "~/server/email/simulated-identity-email";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("Bloqueo temporal de identidad por contraseñas incorrectas", () => {
  databaseTest(
    "bloquea 15 minutos tras cinco contraseñas incorrectas, avisa por correo y audita",
    async () => {
      const fixture = await createFixture();
      const wrongPassword = "Contraseña-equivocada-APO-56";

      try {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const response = await signIn(
            request("/api/clinic-access/sign-in", {
              email: fixture.ownerEmail,
              password: wrongPassword,
            }),
          );
          expect(response.status).toBe(401);
        }
        const notices = getSentIdentityPasswordBlockNotices();
        expect(notices.at(-1)).toBe(fixture.ownerEmail);

        const blocked = await signIn(
          request("/api/clinic-access/sign-in", {
            email: fixture.ownerEmail,
            password: fixture.password,
          }),
        );
        expect(blocked.status).toBe(423);

        const events = await readAuditEvents(fixture);
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: "identity-login-blocked",
              actorIdentityId: fixture.identityId,
              result: "succeeded",
            }),
          ]),
        );

        // Una vez vencidos los 15 minutos vuelve a admitir la contraseña.
        await db.transaction(async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.identity_id', ${fixture.identityId}, true)`,
          );
          await transaction
            .update(identityLoginFailures)
            .set({ failedAt: new Date(Date.now() - 16 * 60 * 1000) })
            .where(eq(identityLoginFailures.identityId, fixture.identityId));
        });

        const afterExpiry = await signIn(
          request("/api/clinic-access/sign-in", {
            email: fixture.ownerEmail,
            password: fixture.password,
          }),
        );
        expect(await afterExpiry.json()).toEqual({ status: "otp-required" });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "una contraseña correcta limpia los intentos fallidos previos",
    async () => {
      const fixture = await createFixture();

      try {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const response = await signIn(
            request("/api/clinic-access/sign-in", {
              email: fixture.ownerEmail,
              password: "Contraseña-equivocada-APO-56",
            }),
          );
          expect(response.status).toBe(401);
        }

        const correct = await signIn(
          request("/api/clinic-access/sign-in", {
            email: fixture.ownerEmail,
            password: fixture.password,
          }),
        );
        expect(await correct.json()).toEqual({ status: "otp-required" });

        const { count } =
          await drizzleIdentityPasswordBlockStore.countRecentFailures({
            identityId: fixture.identityId,
            since: new Date(Date.now() - 15 * 60 * 1000),
          });
        expect(count).toBe(0);
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

function request(path: string, body: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    method: "POST",
  });
}

async function createFixture() {
  const superadminId = `apo-56-superadmin-${randomUUID()}`;
  const ownerEmail = `apo-56-owner-${randomUUID()}@example.test`;
  const clinicName = `Clínica Aurora APO-56 ${randomUUID()}`;
  const password = "Contraseña-segura-APO-56";

  await db.insert(identities).values({
    id: superadminId,
    name: "Superadmin sintético APO-56",
    email: `${superadminId}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(apoloSuperadmins).values({ identityId: superadminId });

  const clinic = await createSyntheticClinic(
    {
      actorIdentityId: superadminId,
      clinicName,
      owner: { email: ownerEmail, name: "Dra. Ana Reyes" },
    },
    {
      registry: drizzleSyntheticClinicRegistration,
      sendOwnerInvitation: sendSimulatedClinicOwnerInvitation,
    },
  );
  const invitation = getSentClinicOwnerInvitations()
    .slice()
    .reverse()
    .find((candidate) => candidate.clinicName === clinicName);
  if (invitation === undefined) throw new Error("Falta la invitación simulada");

  const activation = await acceptClinicOwnerInvitation({
    password,
    token: invitation.token,
  });

  return {
    clinicId: clinic.id,
    clinicName,
    identityId: activation.identityId,
    ownerEmail,
    password,
    superadminId,
    async cleanup() {
      await inSuperadminTransaction(superadminId, async (transaction) => {
        await transaction.execute(
          sql`select set_config('app.clinic_id', ${clinic.id}, true)`,
        );
        await transaction
          .delete(identityAuditEvents)
          .where(eq(identityAuditEvents.clinicId, clinic.id));
        await transaction.delete(clinics).where(eq(clinics.id, clinic.id));
      });
      await db
        .delete(identities)
        .where(eq(identities.id, activation.identityId));
      await db
        .delete(apoloSuperadmins)
        .where(eq(apoloSuperadmins.identityId, superadminId));
      await db.delete(identities).where(eq(identities.id, superadminId));
    },
  };
}

async function readAuditEvents(
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  return inSuperadminTransaction(fixture.superadminId, async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
    );
    return transaction.query.identityAuditEvents.findMany({
      where: eq(identityAuditEvents.clinicId, fixture.clinicId),
    });
  });
}
