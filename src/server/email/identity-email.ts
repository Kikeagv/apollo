import "server-only";

import { env } from "~/env";
import { createResendIdentityEmailSender } from "~/server/email/resend-identity-email";
import { simulatedIdentityEmailSender } from "~/server/email/simulated-identity-email";

export type IdentityOtp = {
  email: string;
  otp: string;
  type: "change-email" | "email-verification" | "forget-password" | "sign-in";
};

/**
 * Puerto de correo de Identidad. Cada mensaje conserva solo contenido
 * administrativo: OTP de inicio o restablecimiento y el aviso de Bloqueo
 * temporal de identidad; nunca incluye datos clínicos ni secretos.
 */
export type IdentityEmailSender = {
  sendIdentityOtp(otp: IdentityOtp): Promise<void>;
  sendPasswordBlockNotice(email: string): Promise<void>;
};

/** El piloto no permite correos simulados en producción: falla al arrancar. */
export function assertIdentityEmailDeliveryAllowed(input: {
  delivery: string;
  nodeEnv: string;
}) {
  if (input.nodeEnv === "production" && input.delivery === "simulated") {
    throw new Error(
      "IDENTITY_EMAIL_DELIVERY=simulated no está permitido en producción; configure resend",
    );
  }
}

assertIdentityEmailDeliveryAllowed({
  delivery: env.IDENTITY_EMAIL_DELIVERY,
  nodeEnv: env.NODE_ENV,
});

/**
 * Selección por configuración del adaptador de correo de Identidad. El modo
 * simulado se conserva para desarrollo y pruebas; producción envía por Resend
 * desde `noreply@usepraxia.com` con la clave solo en Coolify.
 */
export function identityEmailSender(): IdentityEmailSender {
  const adapters = {
    simulated: () => simulatedIdentityEmailSender,
    resend: () =>
      createResendIdentityEmailSender({ apiKey: env.RESEND_API_KEY }),
  } satisfies Record<
    typeof env.IDENTITY_EMAIL_DELIVERY,
    () => IdentityEmailSender
  >;
  return adapters[env.IDENTITY_EMAIL_DELIVERY]();
}
