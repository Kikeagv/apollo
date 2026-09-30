import "server-only";

import type {
  IdentityEmailSender,
  IdentityOtp,
} from "~/server/email/identity-email";
import type { DailyAgendaEmail } from "~/server/application/appointment-reminders";
import type {
  ClinicDoctorInvitationDelivery,
  ClinicOwnerInvitationDelivery,
  ClinicWhatsAppSetupLinkDelivery,
} from "~/server/email/clinic-invitation-email";
import { env } from "~/env";
import { clinicInvitationUrl } from "~/domain/clinic-invitation";

type ClinicOwnerInvitation = ClinicOwnerInvitationDelivery & {
  activationUrl: string;
};

type ClinicDoctorInvitation = ClinicDoctorInvitationDelivery & {
  activationUrl: string;
};

const sentIdentityOtps: IdentityOtp[] = [];
const sentIdentityPasswordBlockNotices: string[] = [];
const sentClinicOwnerInvitations: ClinicOwnerInvitation[] = [];
const sentClinicDoctorInvitations: ClinicDoctorInvitation[] = [];
const sentClinicWhatsAppSetupLinks: ClinicWhatsAppSetupLinkDelivery[] = [];
const sentDailyAgendaEmails: Array<
  DailyAgendaEmail & { idempotencyKey?: string; pdf: Uint8Array }
> = [];

/** Adaptador de correo sintético para desarrollo y pruebas de integración. */
export const simulatedIdentityEmailSender: IdentityEmailSender = {
  async sendIdentityOtp(otp) {
    sentIdentityOtps.push(otp);
  },
  async sendPasswordBlockNotice(email) {
    sentIdentityPasswordBlockNotices.push(email);
  },
};

export function getSentIdentityOtps() {
  return [...sentIdentityOtps];
}

export function getSentIdentityPasswordBlockNotices() {
  return [...sentIdentityPasswordBlockNotices];
}

/** Adaptador simulado para iniciar invitaciones de médicos propietarios. */
export async function sendSimulatedClinicOwnerInvitation(
  invitation: ClinicOwnerInvitationDelivery,
) {
  sentClinicOwnerInvitations.push({
    ...invitation,
    activationUrl: clinicInvitationUrl(env.PUBLIC_SITE_URL, invitation.token),
  });
}

export function getSentClinicOwnerInvitations() {
  return [...sentClinicOwnerInvitations];
}

/** Adaptador simulado para invitar Médicos adicionales desde Panacea. */
export async function sendSimulatedClinicDoctorInvitation(
  invitation: Omit<ClinicDoctorInvitation, "activationUrl">,
) {
  sentClinicDoctorInvitations.push({
    ...invitation,
    activationUrl: clinicInvitationUrl(env.PUBLIC_SITE_URL, invitation.token),
  });
}

export function getSentClinicDoctorInvitations() {
  return [...sentClinicDoctorInvitations];
}

/** Adaptador simulado que conserva la evidencia de envío del setup link. */
export async function sendSimulatedClinicWhatsAppSetupLink(
  invitation: ClinicWhatsAppSetupLinkDelivery,
) {
  sentClinicWhatsAppSetupLinks.push(invitation);
}

export function getSentClinicWhatsAppSetupLinks() {
  return [...sentClinicWhatsAppSetupLinks];
}

/** Adaptador de correo simulado para el PDF nocturno de la Agenda. */
export const simulatedDailyAgendaEmailSender = {
  async send(email: DailyAgendaEmail & { pdf: Uint8Array }) {
    sentDailyAgendaEmails.push(email);
  },
};

/** El correo simulado conserva la clave para que reintentos no dupliquen el PDF. */
export async function sendSimulatedDailyAgenda(
  email: DailyAgendaEmail & { idempotencyKey: string; pdf: Uint8Array },
) {
  if (
    sentDailyAgendaEmails.some(
      (sent) => sent.idempotencyKey === email.idempotencyKey,
    )
  )
    return;
  sentDailyAgendaEmails.push(email);
}

export function getSentDailyAgendaEmails() {
  return [...sentDailyAgendaEmails];
}
