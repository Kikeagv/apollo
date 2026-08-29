import "server-only";

import type { DemoRequest } from "~/domain/demo-request";

import {
  DEMO_REQUEST_EMAIL_SUBJECT,
  DEMO_REQUEST_EMAIL_TO,
  formatDemoRequestEmail,
} from "./demo-request-email-content";
import type { DemoRequestEmailSender } from "./demo-request-email";
import { sendResendEmail } from "./resend-identity-email";

export { DEMO_REQUEST_EMAIL_TO } from "./demo-request-email-content";

/**
 * Adaptador de la Solicitud de demo sobre Resend. El remitente permanece en
 * el dominio verificado de Praxia y el destinatario es el buzón comercial.
 */
export function createResendDemoRequestEmailSender(input: {
  apiKey?: string;
}): DemoRequestEmailSender {
  if (input.apiKey === undefined || input.apiKey === "") {
    throw new Error(
      "RESEND_API_KEY es obligatoria para enviar solicitudes de demo por Resend",
    );
  }
  const apiKey = input.apiKey;

  return {
    async sendDemoRequest(request: DemoRequest) {
      await sendResendEmail(apiKey, {
        subject: DEMO_REQUEST_EMAIL_SUBJECT,
        text: formatDemoRequestEmail(request),
        to: DEMO_REQUEST_EMAIL_TO,
      });
    },
  };
}
