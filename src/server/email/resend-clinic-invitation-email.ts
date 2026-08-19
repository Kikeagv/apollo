import "server-only";

import { env } from "~/env";
import { sendResendEmail } from "~/server/email/resend-identity-email";
import type {
  ClinicInvitationEmailSender,
  ClinicDoctorInvitationDelivery,
  ClinicOwnerInvitationDelivery,
} from "~/server/email/clinic-invitation-email";

const INVITATION_ROUTE = "/activar-invitacion";

/**
 * Adaptador real de invitaciones de clínica sobre Resend. Falla rápido si la
 * clave no está configurada; la clave vive solo como secreto de Coolify.
 */
export function createResendClinicInvitationEmailSender(input: {
  apiKey?: string;
}): ClinicInvitationEmailSender {
  if (input.apiKey === undefined || input.apiKey === "") {
    throw new Error(
      "RESEND_API_KEY es obligatoria para las invitaciones de clínica por Resend",
    );
  }
  const apiKey = input.apiKey;
  const activationUrl = (token: string) =>
    new URL(
      `${INVITATION_ROUTE}?token=${encodeURIComponent(token)}`,
      env.BETTER_AUTH_URL,
    ).toString();

  return {
    async sendOwnerInvitation(invitation: ClinicOwnerInvitationDelivery) {
      await sendResendEmail(apiKey, {
        subject: `Invitación a ${invitation.clinicName} en Praxia`,
        text: ownerInvitationText(invitation, activationUrl(invitation.token)),
        to: invitation.ownerEmail,
      });
    },
    async sendDoctorInvitation(invitation: ClinicDoctorInvitationDelivery) {
      await sendResendEmail(apiKey, {
        subject: `Invitación a ${invitation.clinicName} en Praxia`,
        text: doctorInvitationText(invitation, activationUrl(invitation.token)),
        to: invitation.recipientEmail,
      });
    },
  };
}

function ownerInvitationText(
  invitation: ClinicOwnerInvitationDelivery,
  activationUrl: string,
) {
  return [
    `Hola ${invitation.ownerName}:`,
    `El equipo de Praxia la/o invitó a administrar la clínica "${invitation.clinicName}".`,
    `Active su cuenta y cree su contraseña en el siguiente enlace (vence el ${invitation.expiresAt.toISOString()}):`,
    activationUrl,
    "Si no esperaba esta invitación, puede ignorar este correo.",
  ].join("\n\n");
}

function doctorInvitationText(
  invitation: ClinicDoctorInvitationDelivery,
  activationUrl: string,
) {
  return [
    `Hola ${invitation.recipientName}:`,
    `El equipo de la clínica "${invitation.clinicName}" la invitó a Praxia.`,
    `Active su cuenta y cree su contraseña en el siguiente enlace (vence el ${invitation.expiresAt.toISOString()}):`,
    activationUrl,
    "Si no esperaba esta invitación, puede ignorar este correo.",
  ].join("\n\n");
}
