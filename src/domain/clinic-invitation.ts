export const clinicInvitationStatuses = [
  "pending",
  "expired",
  "accepted",
] as const;
export type ClinicInvitationStatus = (typeof clinicInvitationStatuses)[number];

export const clinicInvitationNextActions = [
  "accept",
  "retry-delivery",
  "renew",
  "wait-delivery",
  "none",
] as const;
export type ClinicInvitationNextAction =
  (typeof clinicInvitationNextActions)[number];

export type ClinicInvitationLastDelivery = "failed" | "succeeded" | null;

export type ClinicInvitationIdentityStatus = "created" | "existing";
export type ClinicInvitationActivationMode = "new" | "existing" | "expired";

export type ClinicInvitationSuccessfulAcceptance = {
  active: true;
  clinicId: string;
  identityId: string;
  identityStatus: ClinicInvitationIdentityStatus;
  invitationStatus: "accepted";
  role: "doctor" | "owner";
};

export type ClinicInvitationExistingIdentityConflict = {
  active: false;
  clinicId: string;
  identityStatus: "existing";
  invitationStatus: "requires-support";
  nextAction: "contact-support";
  role: "doctor" | "owner";
};

/** Resultado público de aceptar una invitación, sin exponer secretos. */
export type ClinicInvitationAcceptance =
  | ClinicInvitationSuccessfulAcceptance
  | ClinicInvitationExistingIdentityConflict;

export function getClinicInvitationStatus(input: {
  consumedAt: Date | null;
  expiresAt: Date;
  now?: Date;
}): ClinicInvitationStatus {
  if (input.consumedAt !== null) return "accepted";
  if ((input.now ?? new Date()).getTime() >= input.expiresAt.getTime()) {
    return "expired";
  }
  return "pending";
}

export function getClinicInvitationNextAction(input: {
  deliveryInProgress?: boolean;
  lastDelivery: ClinicInvitationLastDelivery;
  status: ClinicInvitationStatus;
}): ClinicInvitationNextAction {
  if (input.status === "accepted") return "none";
  if (input.deliveryInProgress === true) return "wait-delivery";
  if (input.status === "expired") return "renew";
  if (input.lastDelivery === "failed") return "retry-delivery";
  return input.lastDelivery === null ? "retry-delivery" : "accept";
}
