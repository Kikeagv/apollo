import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { POST as signIn } from "~/app/api/clinic-access/sign-in/route";
import { POST as recordActivity } from "~/app/api/clinic-access/activity/route";
import { POST as verifyOtp } from "~/app/api/clinic-access/verify-otp/route";
import {
  CLINIC_SESSION_COOKIE,
  CLINIC_TRUSTED_DEVICE_COOKIE,
  findTrustedClinicContext,
  hashOpaqueAccessToken,
} from "~/server/application/clinic-access";
import { acceptClinicOwnerInvitation } from "~/server/application/accept-clinic-owner-invitation";
import { createSyntheticClinic } from "~/server/application/create-synthetic-clinic";
import { db } from "~/server/db";
import {
  inClinicTransaction,
  inSuperadminTransaction,
} from "~/server/db/clinic-context";
import {
  apoloSuperadmins,
  clinicSessions,
  clinicUsers,
  clinics,
  identityAuditEvents,
  session as authSessions,
  trustedClinicDevices,
  user as identities,
} from "~/server/db/schema";
import { drizzleSyntheticClinicRegistration } from "~/server/db/synthetic-clinic-registration";
import {
  getSentClinicOwnerInvitations,
  getSentIdentityOtps,
  sendSimulatedClinicOwnerInvitation,
} from "~/server/email/simulated-identity-email";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("inicio seguro persistente de Panacea", () => {
  databaseTest(
    "exige OTP en navegador nuevo, conserva confianza 30 días y audita sin secretos",
    async () => {
      const fixture = await createFixture();

      try {
        const firstSignIn = await signIn(
          request("/api/clinic-access/sign-in", {
            email: fixture.ownerEmail,
            password: fixture.password,
          }),
        );
        expect(await firstSignIn.json()).toEqual({ status: "otp-required" });
        expect(
          findCookie(firstSignIn.headers, CLINIC_SESSION_COOKIE),
        ).toBeUndefined();
        const sessionCookie = findCookie(
          firstSignIn.headers,
          "better-auth.session_token",
        );
        expect(sessionCookie).toBeDefined();

        const emailWithOtp = getSentIdentityOtps().at(-1);
        expect(emailWithOtp).toMatchObject({
          email: fixture.ownerEmail,
          type: "sign-in",
        });
        if (emailWithOtp === undefined)
          throw new Error("Falta el OTP simulado");

        const verified = await verifyOtp(
          request(
            "/api/clinic-access/verify-otp",
            { otp: emailWithOtp.otp },
            `better-auth.session_token=${sessionCookie}`,
          ),
        );
        expect(await verified.json()).toEqual({ status: "authenticated" });
        const trustedDeviceToken = findCookie(
          verified.headers,
          CLINIC_TRUSTED_DEVICE_COOKIE,
        );
        expect(trustedDeviceToken).toBeDefined();
        if (trustedDeviceToken === undefined) {
          throw new Error("Falta el dispositivo confiable");
        }
        const clinicSessionToken = findCookie(
          verified.headers,
          CLINIC_SESSION_COOKIE,
        );
        if (clinicSessionToken === undefined) {
          throw new Error("Falta la Sesión de Clínica");
        }

        const context = await findTrustedClinicContext({
          clinicSessionToken,
          identityId: fixture.identityId,
          trustedDeviceToken,
        });
        expect(context).toMatchObject({
          clinicId: fixture.clinicId,
          clinicName: fixture.clinicName,
          identityId: fixture.identityId,
        });
        const authSession = await db.query.session.findFirst({
          where: eq(authSessions.userId, fixture.identityId),
        });
        expect(authSession).toBeDefined();
        expect(authSession?.expiresAt.getTime()).toBeGreaterThan(
          Date.now() + 29 * 60 * 1000,
        );
        expect(authSession?.expiresAt.getTime()).toBeLessThanOrEqual(
          Date.now() + 30 * 60 * 1000 + 2_000,
        );
        const clinicSession = await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.identityId },
          (transaction) =>
            transaction.query.clinicSessions.findFirst({
              where: eq(
                clinicSessions.tokenHash,
                hashOpaqueAccessToken(clinicSessionToken),
              ),
            }),
        );
        expect(clinicSession?.expiresAt.getTime()).toBeGreaterThan(
          Date.now() + 29 * 60 * 1000,
        );
        const trustedDevice = await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.identityId },
          (transaction) =>
            transaction.query.trustedClinicDevices.findFirst({
              where: eq(
                trustedClinicDevices.tokenHash,
                hashOpaqueAccessToken(trustedDeviceToken),
              ),
            }),
        );
        expect(trustedDevice?.expiresAt.getTime()).toBeGreaterThan(
          Date.now() + (30 * 24 - 1) * 60 * 60 * 1000,
        );

        const activity = await recordActivity(
          request(
            "/api/clinic-access/activity",
            {},
            `better-auth.session_token=${sessionCookie}; ${CLINIC_TRUSTED_DEVICE_COOKIE}=${trustedDeviceToken}; ${CLINIC_SESSION_COOKIE}=${clinicSessionToken}`,
          ),
        );
        expect(await activity.json()).toEqual({ status: "active" });
        const renewedClinicSession = await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.identityId },
          (transaction) =>
            transaction.query.clinicSessions.findFirst({
              where: eq(
                clinicSessions.tokenHash,
                hashOpaqueAccessToken(clinicSessionToken),
              ),
            }),
        );
        expect(renewedClinicSession?.expiresAt.getTime()).toBeGreaterThan(
          clinicSession?.expiresAt.getTime() ?? 0,
        );

        const trustedSignIn = await signIn(
          request(
            "/api/clinic-access/sign-in",
            { email: fixture.ownerEmail, password: fixture.password },
            `${CLINIC_TRUSTED_DEVICE_COOKIE}=${trustedDeviceToken}`,
          ),
        );
        expect(await trustedSignIn.json()).toEqual({ status: "authenticated" });
        expect(
          findCookie(trustedSignIn.headers, CLINIC_SESSION_COOKIE),
        ).toBeDefined();

        const events = await readAuditEvents(fixture);
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: "identity-login-succeeded",
              actorIdentityId: fixture.identityId,
              result: "succeeded",
            }),
          ]),
        );
        const serialized = JSON.stringify(events);
        expect(serialized).not.toContain(fixture.password);
        expect(serialized).not.toContain(emailWithOtp.otp);
        expect(Object.keys(events[0] ?? {})).not.toContain("patient");

        await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.identityId },
          (transaction) =>
            transaction
              .update(clinicSessions)
              .set({ expiresAt: new Date(Date.now() - 1) })
              .where(
                eq(
                  clinicSessions.tokenHash,
                  hashOpaqueAccessToken(clinicSessionToken),
                ),
              ),
        );
        const expiredActivity = await recordActivity(
          request(
            "/api/clinic-access/activity",
            {},
            `better-auth.session_token=${sessionCookie}; ${CLINIC_TRUSTED_DEVICE_COOKIE}=${trustedDeviceToken}; ${CLINIC_SESSION_COOKIE}=${clinicSessionToken}`,
          ),
        );
        expect(expiredActivity.status).toBe(403);
        await expect(readAuditEvents(fixture)).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: "identity-login-failed",
              actorIdentityId: fixture.identityId,
              result: "failed",
            }),
          ]),
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "una Identidad sin membresía activa nunca obtiene contexto clínico",
    async () => {
      const identityId = `apo-29-sin-membresia-${randomUUID()}`;
      await db.insert(identities).values({
        id: identityId,
        name: "Identidad sin membresía APO-29",
        email: `${identityId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      try {
        await expect(
          findTrustedClinicContext({
            clinicSessionToken: "sesion-ajena",
            identityId,
            trustedDeviceToken: "dispositivo-ajeno",
          }),
        ).resolves.toBeUndefined();
      } finally {
        await db.delete(identities).where(eq(identities.id, identityId));
      }
    },
  );

  databaseTest(
    "una membresía suspendida invalida el contexto aun con dispositivo y Sesión válidos",
    async () => {
      const fixture = await createFixture();
      const trustedDeviceToken = "dispositivo-suspendido";
      const clinicSessionToken = "sesion-suspendida";

      try {
        await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.identityId },
          async (transaction) => {
            await transaction.insert(trustedClinicDevices).values({
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              identityId: fixture.identityId,
              tokenHash: hashOpaqueAccessToken(trustedDeviceToken),
            });
            await transaction.insert(clinicSessions).values({
              expiresAt: new Date(Date.now() + 30 * 60 * 1000),
              identityId: fixture.identityId,
              tokenHash: hashOpaqueAccessToken(clinicSessionToken),
            });
            await transaction
              .update(clinicUsers)
              .set({ active: false })
              .where(eq(clinicUsers.identityId, fixture.identityId));
          },
        );

        await expect(
          findTrustedClinicContext({
            clinicSessionToken,
            identityId: fixture.identityId,
            trustedDeviceToken,
          }),
        ).resolves.toBeUndefined();
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "audita una contraseña incorrecta sin crear contexto de Clínica",
    async () => {
      const fixture = await createFixture();

      try {
        const response = await signIn(
          request("/api/clinic-access/sign-in", {
            email: fixture.ownerEmail,
            password: "No-se-archiva-esta-contraseña",
          }),
        );
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
          error: "Credenciales inválidas",
        });

        const events = await readAuditEvents(fixture);
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: "identity-login-failed",
              result: "failed",
            }),
          ]),
        );
        expect(JSON.stringify(events)).not.toContain(
          "No-se-archiva-esta-contraseña",
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "acepta el inicio aunque el host de la petición difiera de BETTER_AUTH_URL",
    async () => {
      const fixture = await createFixture();

      try {
        const response = await signIn(
          new Request(
            "http://app.usepraxia.com:3000/api/clinic-access/sign-in",
            {
              body: JSON.stringify({
                email: fixture.ownerEmail,
                password: fixture.password,
              }),
              headers: {
                "content-type": "application/json",
                origin: "http://app.usepraxia.com:3000",
              },
              method: "POST",
            },
          ),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: "otp-required" });
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

function request(path: string, body: unknown, cookie?: string) {
  return new Request(`http://localhost:3000${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      ...(cookie === undefined ? {} : { cookie }),
    },
    method: "POST",
  });
}

function findCookie(headers: Headers, name: string) {
  const supportedHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const cookies = supportedHeaders.getSetCookie?.() ?? [
    headers.get("set-cookie"),
  ];
  return cookies
    .find((cookie): cookie is string => cookie?.startsWith(`${name}=`) ?? false)
    ?.split(";", 1)[0]
    ?.slice(name.length + 1);
}

async function createFixture() {
  const superadminId = `apo-29-superadmin-${randomUUID()}`;
  const ownerEmail = `apo-29-owner-${randomUUID()}@example.test`;
  const clinicName = `Clínica Aurora APO-29 ${randomUUID()}`;
  const password = "Contraseña-segura-APO-29";

  await db.insert(identities).values({
    id: superadminId,
    name: "Superadmin sintético APO-29",
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
        .delete(trustedClinicDevices)
        .where(eq(trustedClinicDevices.identityId, activation.identityId));
      await db
        .delete(clinicSessions)
        .where(eq(clinicSessions.identityId, activation.identityId));
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
