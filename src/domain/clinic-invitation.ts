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
export type ClinicInvitationRole = "doctor" | "owner";
export type ClinicInvitationActivationMode =
  "new" | "existing" | "expired" | "accepted";
export type ClinicInvitationActivationContext = {
  mode: ClinicInvitationActivationMode;
  role: ClinicInvitationRole;
};

/** Origen público estable para los enlaces enviados por los adaptadores. */
export function clinicInvitationUrl(publicSiteUrl: string, token: string) {
  const origin = new URL(publicSiteUrl).origin;
  return new URL(
    `/activar-invitacion?token=${encodeURIComponent(token)}`,
    `${origin}/`,
  ).toString();
}

export type ClinicInvitationSuccessfulAcceptance = {
  active: true;
  clinicId: string;
  identityId: string;
  identityStatus: ClinicInvitationIdentityStatus;
  invitationStatus: "accepted";
  role: ClinicInvitationRole;
};

export type ClinicInvitationExistingIdentityConflict = {
  active: false;
  clinicId: string;
  identityStatus: "existing";
  invitationStatus: "requires-support";
  nextAction: "contact-support";
  role: ClinicInvitationRole;
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
