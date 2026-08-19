import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, sql } from "drizzle-orm";

import { auth } from "~/server/better-auth";
import { db } from "~/server/db";
import { inClinicTransaction } from "~/server/db/clinic-context";
import { env } from "~/env";
import {
  type ClinicUserRole,
  clinics,
  clinicSessions,
  clinicUsers,
  identityAuditEvents,
  trustedClinicDevices,
  verification,
} from "~/server/db/schema";

export const CLINIC_TRUSTED_DEVICE_COOKIE = "panacea-trusted-device";
export const CLINIC_SESSION_COOKIE = "panacea-clinic-session";
export const TRUSTED_DEVICE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const CLINIC_SESSION_IDLE_DURATION_MS = 30 * 60 * 1000;

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type ActiveMembership = {
  clinicId: string;
  identityId: string;
  role: ClinicUserRole;
};

export type ClinicContext = ActiveMembership & {
  clinicName: string;
};

export class ClinicAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClinicAccessError";
  }
}

/** Devuelve contexto clínico solo cuando la Identidad conserva membresía activa. */
export async function findActiveClinicContext(
  identityId: string,
): Promise<ClinicContext | undefined> {
  const membership = await findActiveMembership(identityId);
  if (membership === undefined) return undefined;

  return inClinicTransaction(membership, async (transaction) => {
    const clinic = await transaction.query.clinics.findFirst({
      where: eq(clinics.id, membership.clinicId),
    });
    if (clinic === undefined) return undefined;
    return { ...membership, clinicName: clinic.name };
  });
}

/** Comprueba el navegador opaco y la membresía antes de permitir abrir Panacea. */
export async function findTrustedClinicContext(input: {
  clinicSessionToken?: string;
  identityId: string;
  trustedDeviceToken?: string;
}): Promise<ClinicContext | undefined> {
  if (
    input.trustedDeviceToken === undefined ||
    input.clinicSessionToken === undefined
  ) {
    return undefined;
  }
  const trustedDeviceToken = input.trustedDeviceToken;
  const clinicSessionToken = input.clinicSessionToken;

  const membership = await db.transaction(async (transaction) => {
    await setIdentityContext(transaction, input.identityId);
    if (
      !(await hasTrustedDevice(
        transaction,
        input.identityId,
        trustedDeviceToken,
      )) ||
      !(await hasActiveClinicSession(
        transaction,
        input.identityId,
        clinicSessionToken,
      ))
    ) {
      return undefined;
    }
    return findActiveMembershipInTransaction(transaction, input.identityId);
  });

  if (membership === undefined) return undefined;
  return findActiveClinicContext(membership.identityId);
}

/** Comprueba el dispositivo antes de emitir una nueva Sesión de Clínica. */
export async function findTrustedDeviceClinicContext(input: {
  identityId: string;
  trustedDeviceToken?: string;
}): Promise<ClinicContext | undefined> {
  if (input.trustedDeviceToken === undefined) return undefined;
  const trustedDeviceToken = input.trustedDeviceToken;

  const membership = await db.transaction(async (transaction) => {
    await setIdentityContext(transaction, input.identityId);
    if (
      !(await hasTrustedDevice(
        transaction,
        input.identityId,
        trustedDeviceToken,
      ))
    ) {
      return undefined;
    }
    return findActiveMembershipInTransaction(transaction, input.identityId);
  });

  if (membership === undefined) return undefined;
  return findActiveClinicContext(membership.identityId);
}

/** Inicia el desafío de correo solo después de una contraseña válida de Better Auth. */
export async function sendClinicLoginOtp(identityId: string, email: string) {
  const membership = await findActiveMembership(identityId);
  if (membership === undefined) {
    throw new ClinicAccessError("La Identidad no tiene una membresía activa");
  }

  await auth.api.sendVerificationOTP({
    body: { email, type: "sign-in" },
    headers: identityEmailHeaders(),
  });
}

/** Verifica y consume el OTP de Better Auth antes de confiar el navegador. */
export async function verifyClinicLoginOtp(input: {
  email: string;
  identityId: string;
  otp: string;
}): Promise<{
  clinicSession: ClinicSession;
  trustedDevice: TrustedDevice;
}> {
  const membership = await findActiveMembership(input.identityId);
  if (membership === undefined) {
    throw new ClinicAccessError("La Identidad no tiene una membresía activa");
  }

  await auth.api.checkVerificationOTP({
    body: { email: input.email, otp: input.otp, type: "sign-in" },
    headers: identityEmailHeaders(),
  });
  await db
    .delete(verification)
    .where(
      eq(verification.identifier, `sign-in-otp-${input.email.toLowerCase()}`),
    );

  const trustedDevice = await createTrustedDevice(input.identityId);
  const clinicSession = await createClinicSession(input.identityId);

  return { clinicSession, trustedDevice };
}

export type ClinicSession = {
  expiresAt: Date;
  token: string;
};

export type TrustedDevice = {
  expiresAt: Date;
  token: string;
};

/** Emite la Sesión de Clínica solo para una Identidad con membresía activa. */
export async function createClinicSession(
  identityId: string,
): Promise<ClinicSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CLINIC_SESSION_IDLE_DURATION_MS);
  await db.transaction(async (transaction) => {
    await setIdentityContext(transaction, identityId);
    if (
      (await findActiveMembershipInTransaction(transaction, identityId)) ===
      undefined
    ) {
      throw new ClinicAccessError("La Identidad no tiene una membresía activa");
    }
    await transaction.insert(clinicSessions).values({
      expiresAt,
      identityId,
      tokenHash: hashOpaqueAccessToken(token),
    });
  });

  return { expiresAt, token };
}

/** Renueva la Sesión de Clínica solo tras actividad autenticada y autorizada. */
export async function renewClinicSession(input: {
  clinicSessionToken?: string;
  identityId: string;
  trustedDeviceToken?: string;
}): Promise<ClinicSession | undefined> {
  if (
    input.trustedDeviceToken === undefined ||
    input.clinicSessionToken === undefined
  ) {
    return undefined;
  }
  const trustedDeviceToken = input.trustedDeviceToken;
  const clinicSessionToken = input.clinicSessionToken;
  const expiresAt = new Date(Date.now() + CLINIC_SESSION_IDLE_DURATION_MS);
  const renewed = await db.transaction(async (transaction) => {
    await setIdentityContext(transaction, input.identityId);
    if (
      !(await hasTrustedDevice(
        transaction,
        input.identityId,
        trustedDeviceToken,
      )) ||
      (await findActiveMembershipInTransaction(
        transaction,
        input.identityId,
      )) === undefined
    ) {
      return undefined;
    }
    const [session] = await transaction
      .update(clinicSessions)
      .set({ expiresAt })
      .where(
        and(
          eq(clinicSessions.identityId, input.identityId),
          eq(
            clinicSessions.tokenHash,
            hashOpaqueAccessToken(clinicSessionToken),
          ),
          gt(clinicSessions.expiresAt, new Date()),
        ),
      )
      .returning({ tokenHash: clinicSessions.tokenHash });
    return session;
  });
  if (renewed === undefined) return undefined;
  return { expiresAt, token: clinicSessionToken };
}

async function createTrustedDevice(identityId: string): Promise<TrustedDevice> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_DURATION_MS);
  await db.transaction(async (transaction) => {
    await setIdentityContext(transaction, identityId);
    await transaction.insert(trustedClinicDevices).values({
      expiresAt,
      identityId,
      tokenHash: hashOpaqueAccessToken(token),
    });
  });
  return { expiresAt, token };
}

async function insertIdentityAuditEvent(input: {
  action: string;
  actorKind: "anonymous" | "identity";
  identityId?: string;
  result: "failed" | "succeeded";
}) {
  const context =
    input.identityId === undefined
      ? undefined
      : await findActiveClinicContext(input.identityId);

  if (context === undefined) {
    await db.insert(identityAuditEvents).values({
      action: input.action,
      actorIdentityId: input.identityId,
      actorKind: input.actorKind,
      clinicId: null,
      result: input.result,
    });
    return;
  }

  await inClinicTransaction(context, async (transaction) => {
    await transaction.insert(identityAuditEvents).values({
      action: input.action,
      actorIdentityId: input.identityId,
      actorKind: "identity",
      clinicId: context.clinicId,
      result: input.result,
    });
  });
}

/** Auditoría reducida: resultado, actor y Clínica, sin secretos ni datos clínicos. */
export async function recordClinicLoginAudit(input: {
  identityId?: string;
  result: "failed" | "succeeded";
}) {
  await insertIdentityAuditEvent({
    action:
      input.result === "succeeded"
        ? "identity-login-succeeded"
        : "identity-login-failed",
    actorKind: input.identityId === undefined ? "anonymous" : "identity",
    identityId: input.identityId,
    result: input.identityId === undefined ? "failed" : input.result,
  });
}

/** Revoca las Sesiones de Clínica y los dispositivos confiables de una Identidad. */
export async function revokeIdentityClinicAccess(identityId: string) {
  await db.transaction(async (transaction) => {
    await setIdentityContext(transaction, identityId);
    await transaction
      .delete(clinicSessions)
      .where(eq(clinicSessions.identityId, identityId));
    await transaction
      .delete(trustedClinicDevices)
      .where(eq(trustedClinicDevices.identityId, identityId));
  });
}

/**
 * Auditoría de seguridad de Identidad: restablecimiento, revocación y bloqueo.
 * Conserva actor, resultado y Clínica cuando aplica; nunca secretos ni OTP.
 */
export async function recordIdentitySecurityAudit(input: {
  action:
    | "identity-login-blocked"
    | "identity-password-reset-succeeded"
    | "identity-sessions-revoked";
  identityId: string;
  result: "failed" | "succeeded";
}) {
  await insertIdentityAuditEvent({
    action: input.action,
    actorKind: "identity",
    identityId: input.identityId,
    result: input.result,
  });
}

export function hashOpaqueAccessToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function findActiveMembership(identityId: string) {
  return db.transaction(async (transaction) => {
    await setIdentityContext(transaction, identityId);
    return findActiveMembershipInTransaction(transaction, identityId);
  });
}

async function findActiveMembershipInTransaction(
  transaction: ClinicTransaction,
  identityId: string,
): Promise<ActiveMembership | undefined> {
  const membership = await transaction.query.clinicUsers.findFirst({
    where: and(
      eq(clinicUsers.identityId, identityId),
      eq(clinicUsers.active, true),
    ),
  });
  if (membership === undefined) return undefined;
  return { clinicId: membership.clinicId, identityId, role: membership.role };
}

async function hasTrustedDevice(
  transaction: ClinicTransaction,
  identityId: string,
  trustedDeviceToken: string,
) {
  const device = await transaction.query.trustedClinicDevices.findFirst({
    where: and(
      eq(trustedClinicDevices.identityId, identityId),
      eq(
        trustedClinicDevices.tokenHash,
        hashOpaqueAccessToken(trustedDeviceToken),
      ),
      gt(trustedClinicDevices.expiresAt, new Date()),
    ),
  });
  return device !== undefined;
}

async function hasActiveClinicSession(
  transaction: ClinicTransaction,
  identityId: string,
  clinicSessionToken: string,
) {
  const session = await transaction.query.clinicSessions.findFirst({
    where: and(
      eq(clinicSessions.identityId, identityId),
      eq(clinicSessions.tokenHash, hashOpaqueAccessToken(clinicSessionToken)),
      gt(clinicSessions.expiresAt, new Date()),
    ),
  });
  return session !== undefined;
}

async function setIdentityContext(
  transaction: ClinicTransaction,
  identityId: string,
) {
  await transaction.execute(
    sql`select set_config('app.identity_id', ${identityId}, true)`,
  );
}

function identityEmailHeaders() {
  return new Headers({ origin: env.BETTER_AUTH_URL });
}
