import { randomUUID } from "node:crypto";

const INVITATION_DURATION_MS = 72 * 60 * 60 * 1_000;
const MAX_RECIPIENT_NAME_LENGTH = 120;

export type DoctorInvitation = {
  clinicId: string;
  clinicName: string;
  email: string;
  expiresAt: Date;
  id: string;
  recipientName: string;
  status: "accepted" | "expired" | "pending";
  token: string;
};

export type DoctorInvitationStore = {
  inviteDoctor(input: {
    clinicId: string;
    email: string;
    expiresAt: Date;
    identityId: string;
    recipientName: string;
    token: string;
  }): Promise<DoctorInvitation | undefined>;
  recordInvitationDelivery(input: {
    clinicId: string;
    identityId: string;
    invitationId: string;
    result: "failed" | "succeeded";
  }): Promise<void>;
};

export class DoctorInvitationAccessError extends Error {
  constructor() {
    super("Solo el Médico propietario puede invitar Médicos");
    this.name = "DoctorInvitationAccessError";
  }
}

/** Inicia la invitación de un Médico y conserva el resultado de su entrega. */
export async function inviteAdditionalDoctor(
  input: {
    clinicId: string;
    identityId: string;
    recipient: { email: string; name: string };
  },
  dependencies: {
    sendInvitation(invitation: DoctorInvitation): Promise<void>;
    store: DoctorInvitationStore;
  },
): Promise<Omit<DoctorInvitation, "token">> {
  const invitation = await dependencies.store.inviteDoctor({
    clinicId: input.clinicId,
    email: requiredEmail(input.recipient.email),
    expiresAt: new Date(Date.now() + INVITATION_DURATION_MS),
    identityId: input.identityId,
    recipientName: requiredName(input.recipient.name),
    token: randomUUID(),
  });
  if (invitation === undefined) throw new DoctorInvitationAccessError();

  try {
    await dependencies.sendInvitation(invitation);
  } catch (error) {
    await dependencies.store.recordInvitationDelivery({
      clinicId: input.clinicId,
      identityId: input.identityId,
      invitationId: invitation.id,
      result: "failed",
    });
    throw error;
  }

  await dependencies.store.recordInvitationDelivery({
    clinicId: input.clinicId,
    identityId: input.identityId,
    invitationId: invitation.id,
    result: "succeeded",
  });
  return {
    clinicId: invitation.clinicId,
    clinicName: invitation.clinicName,
    email: invitation.email,
    expiresAt: invitation.expiresAt,
    id: invitation.id,
    recipientName: invitation.recipientName,
    status: invitation.status,
  };
}

function requiredEmail(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) {
    throw new Error("El correo del Médico no es válido");
  }
  return normalized;
}

function requiredName(value: string) {
  const normalized = value.trim();
  if (normalized.length === 0)
    throw new Error("El nombre del Médico es obligatorio");
  if (normalized.length > MAX_RECIPIENT_NAME_LENGTH) {
    throw new Error(
      `El valor no puede exceder ${MAX_RECIPIENT_NAME_LENGTH} caracteres`,
    );
  }
  return normalized;
}
