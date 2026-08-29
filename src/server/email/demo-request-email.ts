import "server-only";

import { env } from "~/env";
import type { DemoRequest } from "~/domain/demo-request";

import { createResendDemoRequestEmailSender } from "./resend-demo-request-email";
import { simulatedDemoRequestEmailSender } from "./simulated-demo-request-email";

export {
  DEMO_REQUEST_EMAIL_SUBJECT,
  DEMO_REQUEST_EMAIL_TO,
  demoRequestContactLabel,
  demoRequestContextLabel,
  demoRequestRoleLabel,
  formatDemoRequestEmail,
} from "./demo-request-email-content";

export type DemoRequestEmailSender = {
  sendDemoRequest(request: DemoRequest): Promise<void>;
};

/** La entrega simulada no puede llegar a producción por accidente. */
export function assertDemoRequestEmailDeliveryAllowed(input: {
  delivery: string;
  nodeEnv: string;
}) {
  if (input.nodeEnv === "production" && input.delivery === "simulated") {
    throw new Error(
      "IDENTITY_EMAIL_DELIVERY=simulated no está permitido para solicitudes de demo en producción; configure resend",
    );
  }
}

assertDemoRequestEmailDeliveryAllowed({
  delivery: env.IDENTITY_EMAIL_DELIVERY,
  nodeEnv: env.NODE_ENV,
});

/**
 * Puerto de correo comercial de la Solicitud de demo. Comparte la selección
 * de entrega de Resend con los correos administrativos existentes.
 */
export function demoRequestEmailSender(): DemoRequestEmailSender {
  const adapters = {
    simulated: () => simulatedDemoRequestEmailSender,
    resend: () =>
      createResendDemoRequestEmailSender({ apiKey: env.RESEND_API_KEY }),
  } satisfies Record<
    typeof env.IDENTITY_EMAIL_DELIVERY,
    () => DemoRequestEmailSender
  >;
  return adapters[env.IDENTITY_EMAIL_DELIVERY]();
}
