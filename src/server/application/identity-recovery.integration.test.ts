import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { POST as signIn } from "~/app/api/clinic-access/sign-in/route";
import { POST as requestPasswordReset } from "~/app/api/clinic-access/request-password-reset/route";
import { POST as resetPassword } from "~/app/api/clinic-access/reset-password/route";
import { POST as verifyOtp } from "~/app/api/clinic-access/verify-otp/route";
import { acceptClinicOwnerInvitation } from "~/server/application/accept-clinic-owner-invitation";
import { createSyntheticClinic } from "~/server/application/create-synthetic-clinic";
import { hashRecoveryIp } from "~/server/application/identity-recovery";
import { db } from "~/server/db";
import {
  inClinicTransaction,
  inSuperadminTransaction,
} from "~/server/db/clinic-context";
import {
  apoloSuperadmins,
  clinicSessions,
  clinics,
  identityAuditEvents,
  identityRecoveryRequests,
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

describe("restablecimiento de contraseña de Identidad", () => {
  databaseTest(
    "funciona de extremo a extremo y revoca Sesiones, dispositivos y sesiones de autenticación",
    async () => {
      const fixture = await createFixture();
      const newPassword = "Nueva-contraseña-APO-56";

      try {
        await clearRecoveryRequests("203.0.113.40");
        const firstSignIn = await signIn(
          request("/api/clinic-access/sign-in", {
            email: fixture.ownerEmail,
            password: fixture.password,
          }),
        );
        expect(await firstSignIn.json()).toEqual({ status: "otp-required" });
        const sessionCookie = findCookie(
          firstSignIn.headers,
          "better-auth.session_token",
        );
        if (sessionCookie === undefined) {
          throw new Error("Falta la sesión de Better Auth");
        }

        const loginOtp = getSentIdentityOtps().at(-1);
        if (loginOtp?.type !== "sign-in") {
          throw new Error("Falta el OTP de inicio simulado");
        }
        const verified = await verifyOtp(
          request(
            "/api/clinic-access/verify-otp",
            { otp: loginOtp.otp },
            `better-auth.session_token=${sessionCookie}`,
          ),
        );
        expect(await verified.json()).toEqual({ status: "authenticated" });

        const resetRequest = await requestPasswordReset(
          request(
            "/api/clinic-access/request-password-reset",
            {
              email: fixture.ownerEmail,
              turnstileToken: "simulated-turnstile-token",
            },
            undefined,
            "203.0.113.40",
          ),
        );
        expect(resetRequest.status).toBe(200);

        const resetOtp = getSentIdentityOtps()
          .slice()
          .reverse()
          .find(
            (otp) =>
              otp.type === "forget-password" &&
              otp.email === fixture.ownerEmail,
          );
        if (resetOtp === undefined) {
          throw new Error("Falta el OTP de restablecimiento simulado");
        }

        const reset = await resetPassword(
          request("/api/clinic-access/reset-password", {
            email: fixture.ownerEmail,
            otp: resetOtp.otp,
            password: newPassword,
          }),
        );
        expect(reset.status).toBe(200);
        expect(await reset.json()).toEqual({ status: "reset" });

        const [remainingSessions, remainingDevices] = await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.identityId },
          async (transaction) => {
            const sessions = await transaction.query.clinicSessions.findMany({
              where: eq(clinicSessions.identityId, fixture.identityId),
            });
            const devices =
              await transaction.query.trustedClinicDevices.findMany({
                where: eq(trustedClinicDevices.identityId, fixture.identityId),
              });
            return [sessions, devices];
          },
        );
        expect(remainingSessions).toEqual([]);
        expect(remainingDevices).toEqual([]);

        const remainingAuthSessions = await db.query.session.findMany({
          where: eq(authSessions.userId, fixture.identityId),
        });
        expect(remainingAuthSessions).toEqual([]);

        const oldPassword = await signIn(
          request("/api/clinic-access/sign-in", {
            email: fixture.ownerEmail,
            password: fixture.password,
          }),
        );
        expect(oldPassword.status).toBe(401);

        const newSignIn = await signIn(
          request("/api/clinic-access/sign-in", {
            email: fixture.ownerEmail,
            password: newPassword,
          }),
        );
        // El dispositivo fue revocado: vuelve a exigir OTP, no abre Panacea.
        expect(await newSignIn.json()).toEqual({ status: "otp-required" });

        const events = await readAuditEvents(fixture);
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: "identity-password-reset-succeeded",
              actorIdentityId: fixture.identityId,
              result: "succeeded",
            }),
            expect.objectContaining({
              action: "identity-sessions-revoked",
              actorIdentityId: fixture.identityId,
              result: "succeeded",
            }),
          ]),
        );
        const serialized = JSON.stringify(events);
        expect(serialized).not.toContain(newPassword);
        expect(serialized).not.toContain(resetOtp.otp);
      } finally {
        await clearRecoveryRequests("203.0.113.40");
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "limita a 5 solicitudes por IP en 15 minutos sin revelar si el correo existe",
    async () => {
      const fixture = await createFixture();

      try {
        await clearRecoveryRequests(
          "203.0.113.50",
          "203.0.113.51",
          "203.0.113.52",
        );
        const ip = "203.0.113.50";
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const response = await requestPasswordReset(
            request(
              "/api/clinic-access/request-password-reset",
              {
                email: fixture.ownerEmail,
                turnstileToken: "simulated-turnstile-token",
              },
              undefined,
              ip,
            ),
          );
          expect(response.status).toBe(200);
        }

        const exceeded = await requestPasswordReset(
          request(
            "/api/clinic-access/request-password-reset",
            {
              email: fixture.ownerEmail,
              turnstileToken: "simulated-turnstile-token",
            },
            undefined,
            ip,
          ),
        );
        expect(exceeded.status).toBe(429);

        const otherIp = await requestPasswordReset(
          request(
            "/api/clinic-access/request-password-reset",
            {
              email: fixture.ownerEmail,
              turnstileToken: "simulated-turnstile-token",
            },
            undefined,
            "203.0.113.51",
          ),
        );
        expect(otherIp.status).toBe(200);

        const otpsBefore = getSentIdentityOtps().length;
        const unknownEmail = await requestPasswordReset(
          request(
            "/api/clinic-access/request-password-reset",
            {
              email: `no-existe-${randomUUID()}@example.test`,
              turnstileToken: "simulated-turnstile-token",
            },
            undefined,
            "203.0.113.52",
          ),
        );
        expect(unknownEmail.status).toBe(200);
        expect(getSentIdentityOtps().length).toBe(otpsBefore);
      } finally {
        await clearRecoveryRequests(
          "203.0.113.50",
          "203.0.113.51",
          "203.0.113.52",
        );
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "cuenta por CF-Connecting-IP cuando el borde lo fija, ignorando x-forwarded-for",
    async () => {
      const fixture = await createFixture();
      const cfIp = "198.51.100.7";

      try {
        await clearRecoveryRequests(cfIp);
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const response = await requestPasswordReset(
            request(
              "/api/clinic-access/request-password-reset",
              {
                email: fixture.ownerEmail,
                turnstileToken: "simulated-turnstile-token",
              },
              undefined,
              `203.0.113.${60 + attempt}`,
              cfIp,
            ),
          );
          expect(response.status).toBe(200);
        }

        // Mismo CF-Connecting-IP con otro x-forwarded-for: sigue el mismo límite.
        const exceeded = await requestPasswordReset(
          request(
            "/api/clinic-access/request-password-reset",
            {
              email: fixture.ownerEmail,
              turnstileToken: "simulated-turnstile-token",
            },
            undefined,
            "203.0.113.99",
            cfIp,
          ),
        );
        expect(exceeded.status).toBe(429);
      } finally {
        await clearRecoveryRequests(cfIp);
        await fixture.cleanup();
      }
    },
  );
});
async function clearRecoveryRequests(...ips: string[]) {
  for (const ip of ips) {
    const ipHash = hashRecoveryIp(ip);
    await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select set_config('app.recovery_request_ip', ${ipHash}, true)`,
      );
      await transaction
        .delete(identityRecoveryRequests)
        .where(eq(identityRecoveryRequests.ipHash, ipHash));
    });
  }
}

function request(
  path: string,
  body: unknown,
  cookie?: string,
  ip?: string,
  cfIp?: string,
) {
  return new Request(`http://localhost:3000${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      ...(cookie === undefined ? {} : { cookie }),
      ...(ip === undefined ? {} : { "x-forwarded-for": ip }),
      ...(cfIp === undefined ? {} : { "cf-connecting-ip": cfIp }),
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
