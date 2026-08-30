import "server-only";

import { PHASE_PRODUCTION_BUILD } from "next/constants";

import { env } from "~/env";
import { createResendClinicInvitationEmailSender } from "~/server/email/resend-clinic-invitation-email";
import {
  sendSimulatedClinicDoctorInvitation,
  sendSimulatedClinicOwnerInvitation,
} from "~/server/email/simulated-identity-email";

export type ClinicOwnerInvitationDelivery = {
  clinicName: string;
  expiresAt: Date;
  ownerEmail: string;
  ownerName: string;
  token: string;
};

export type ClinicDoctorInvitationDelivery = {
  clinicName: string;
  expiresAt: Date;
  recipientEmail: string;
  recipientName: string;
  token: string;
};

/**
 * Puerto de correo de invitaciones de clínica. Los mensajes conservan solo
 * contenido administrativo: nombre de la Clínica, destinatario, vencimiento y
 * el enlace de activación; nunca incluyen datos clínicos ni secretos.
 */
export type ClinicInvitationEmailSender = {
  sendOwnerInvitation(invitation: ClinicOwnerInvitationDelivery): Promise<void>;
  sendDoctorInvitation(
    invitation: ClinicDoctorInvitationDelivery,
  ): Promise<void>;
};

/** Las invitaciones no pueden simularse en producción: falla al arrancar. */
export function assertClinicInvitationEmailDeliveryAllowed(input: {
  delivery: string;
  nodeEnv: string;
}) {
  if (input.nodeEnv === "production" && input.delivery === "simulated") {
    throw new Error(
      "IDENTITY_EMAIL_DELIVERY=simulated no permite invitaciones de clínica en producción; configure resend",
    );
  }
}

if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) {
  assertClinicInvitationEmailDeliveryAllowed({
    delivery: env.IDENTITY_EMAIL_DELIVERY,
    nodeEnv: env.NODE_ENV,
  });
}

/**
 * Selección por configuración del adaptador de invitaciones de clínica. El
 * modo simulado se conserva para desarrollo y pruebas; producción envía por
 * Resend desde `noreply@usepraxia.com` con la clave solo en Coolify.
 */
export function clinicInvitationEmailSender(): ClinicInvitationEmailSender {
  const adapters = {
    simulated: () => ({
      sendDoctorInvitation: sendSimulatedClinicDoctorInvitation,
      sendOwnerInvitation: sendSimulatedClinicOwnerInvitation,
    }),
    resend: () =>
      createResendClinicInvitationEmailSender({
        apiKey: env.RESEND_API_KEY,
      }),
  } satisfies Record<
    typeof env.IDENTITY_EMAIL_DELIVERY,
    () => ClinicInvitationEmailSender
  >;
  return adapters[env.IDENTITY_EMAIL_DELIVERY]();
}
