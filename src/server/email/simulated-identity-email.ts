import "server-only";

import type {
  IdentityEmailSender,
  IdentityOtp,
} from "~/server/email/identity-email";
import type { DailyAgendaEmail } from "~/server/application/appointment-reminders";
import type {
  ClinicDoctorInvitationDelivery,
  ClinicOwnerInvitationDelivery,
} from "~/server/email/clinic-invitation-email";

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
    activationUrl: `/activar-invitacion?token=${encodeURIComponent(invitation.token)}`,
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
    activationUrl: `/activar-invitacion?token=${encodeURIComponent(invitation.token)}`,
  });
}

export function getSentClinicDoctorInvitations() {
  return [...sentClinicDoctorInvitations];
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
