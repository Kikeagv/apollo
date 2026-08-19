import { createHash } from "node:crypto";

export const MAX_RECOVERY_REQUESTS_PER_IP = 5;
export const RECOVERY_REQUEST_WINDOW_MS = 15 * 60 * 1000;

export type IdentityRecoveryRequestStore = {
  countRecent(input: { ipHash: string; since: Date }): Promise<number>;
  record(input: { ipHash: string; requestedAt: Date }): Promise<void>;
};

export type PasswordResetRequestResult =
  "rate-limited" | "sent" | "turnstile-rejected";

export class PasswordResetError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PasswordResetError";
  }
}

/**
 * El hash no conserva la IP en claro; solo permite contar solicitudes por IP
 * dentro de la ventana sin exponer el origen.
 */
export function hashRecoveryIp(ip: string) {
  return createHash("sha256").update(`recovery-ip:${ip}`).digest("hex");
}

/**
 * Solicita el código de restablecimiento. Turnstile se valida antes de
 * cualquier efecto; el límite por IP no revela si el correo existe.
 */
export async function requestIdentityPasswordReset(
  input: {
    email: string;
    ip: string;
    turnstileToken: string;
  },
  deps: {
    sendResetOtp(email: string): Promise<void>;
    store: IdentityRecoveryRequestStore;
    verifyTurnstile(input: { token: string; ip: string }): Promise<boolean>;
  },
): Promise<PasswordResetRequestResult> {
  const turnstileOk = await deps.verifyTurnstile({
    token: input.turnstileToken,
    ip: input.ip,
  });
  if (!turnstileOk) return "turnstile-rejected";

  const ipHash = hashRecoveryIp(input.ip);
  const now = new Date();
  const recent = await deps.store.countRecent({
    ipHash,
    since: new Date(now.getTime() - RECOVERY_REQUEST_WINDOW_MS),
  });
  if (recent >= MAX_RECOVERY_REQUESTS_PER_IP) return "rate-limited";

  await deps.sendResetOtp(input.email.trim().toLowerCase());
  await deps.store.record({ ipHash, requestedAt: now });
  return "sent";
}

/**
 * Completa el restablecimiento: consume el OTP, cambia la contraseña y revoca
 * las Sesiones de Clínica y los dispositivos confiables de la Identidad.
 */
export async function resetIdentityPassword(
  input: {
    email: string;
    otp: string;
    password: string;
  },
  deps: {
    findIdentityId(email: string): Promise<string | undefined>;
    recordAudit(input: {
      action: "identity-password-reset-succeeded" | "identity-sessions-revoked";
      identityId: string;
    }): Promise<void>;
    resetPassword(input: {
      email: string;
      otp: string;
      password: string;
    }): Promise<void>;
    revokeClinicAccess(identityId: string): Promise<void>;
  },
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  await deps.resetPassword({ email, otp: input.otp, password: input.password });
  const identityId = await deps.findIdentityId(email);
  if (identityId === undefined) {
    throw new PasswordResetError("No existe una Identidad para este correo");
  }
  await deps.revokeClinicAccess(identityId);
  await deps.recordAudit({
    action: "identity-password-reset-succeeded",
    identityId,
  });
  await deps.recordAudit({
    action: "identity-sessions-revoked",
    identityId,
  });
}
