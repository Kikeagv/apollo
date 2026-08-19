import "server-only";

import type {
  IdentityEmailSender,
  IdentityOtp,
} from "~/server/email/identity-email";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
export const IDENTITY_FROM_ADDRESS = "Praxia <noreply@usepraxia.com>";

/**
 * Adaptador real de correo de Identidad sobre Resend. Falla rápido si la clave
 * no está configurada; la clave vive solo como secreto de Coolify.
 */
export function createResendIdentityEmailSender(input: {
  apiKey?: string;
}): IdentityEmailSender {
  if (input.apiKey === undefined || input.apiKey === "") {
    throw new Error(
      "RESEND_API_KEY es obligatoria para enviar correos de Identidad por Resend",
    );
  }
  const apiKey = input.apiKey;

  return {
    async sendIdentityOtp(otp) {
      await sendResendEmail(apiKey, {
        subject: otpSubject(otp.type),
        text: otpText(otp),
        to: otp.email,
      });
    },
    async sendPasswordBlockNotice(email) {
      await sendResendEmail(apiKey, {
        subject: "Intento de acceso bloqueado en Praxia",
        text: [
          "Detectamos cinco intentos fallidos de contraseña para su cuenta.",
          "El inicio de sesión quedó bloqueado temporalmente durante 15 minutos.",
          "Si no fue usted, restablezca su contraseña o contacte a su Clínica.",
        ].join("\n\n"),
        to: email,
      });
    },
  };
}

function otpSubject(type: IdentityOtp["type"]) {
  return type === "forget-password"
    ? "Código para restablecer su contraseña"
    : "Código de verificación de Praxia";
}

function otpText(otp: IdentityOtp) {
  return [
    `Su código de un solo uso es ${otp.otp}.`,
    "Expira en 5 minutos.",
    "No comparta este código con nadie.",
    "Si no solicitó este correo, puede ignorarlo.",
  ].join("\n\n");
}

export async function sendResendEmail(
  apiKey: string,
  input: { subject: string; text: string; to: string },
) {
  const response = await fetch(RESEND_EMAILS_URL, {
    body: JSON.stringify({
      from: IDENTITY_FROM_ADDRESS,
      subject: input.subject,
      text: input.text,
      to: [input.to],
    }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `Resend rechazó el correo con estado ${response.status}`,
    );
  }
}
