import "server-only";

import type { DailyAgendaEmail } from "~/server/application/appointment-reminders";

type IdentityOtp = {
  email: string;
  otp: string;
  type: "change-email" | "email-verification" | "forget-password" | "sign-in";
};

type ClinicOwnerInvitation = {
  activationUrl: string;
  clinicName: string;
  expiresAt: Date;
  ownerEmail: string;
  ownerName: string;
  token: string;
};

type ClinicDoctorInvitation = {
  activationUrl: string;
  clinicName: string;
  expiresAt: Date;
  recipientEmail: string;
  recipientName: string;
  token: string;
};

type ClinicOwnerInvitationDelivery = Omit<
  ClinicOwnerInvitation,
  "activationUrl"
>;

const sentIdentityOtps: IdentityOtp[] = [];
const sentClinicOwnerInvitations: ClinicOwnerInvitation[] = [];
const sentClinicDoctorInvitations: ClinicDoctorInvitation[] = [];
const sentDailyAgendaEmails: Array<DailyAgendaEmail & { pdf: Uint8Array }> = [];

/** Adaptador de correo sintético para desarrollo y pruebas de integración. */
export async function sendSimulatedIdentityEmail(otp: IdentityOtp) {
  sentIdentityOtps.push(otp);
}

export function getSentIdentityOtps() {
  return [...sentIdentityOtps];
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

export function getSentDailyAgendaEmails() {
  return [...sentDailyAgendaEmails];
}
