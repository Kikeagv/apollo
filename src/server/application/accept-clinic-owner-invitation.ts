import {
  drizzleClinicOwnerInvitationActivation,
  type ClinicOwnerInvitationActivation,
} from "~/server/db/clinic-owner-invitation-activation";

import { ClinicOwnerInvitationError } from "./clinic-owner-invitation-errors";

export { ClinicOwnerInvitationError } from "./clinic-owner-invitation-errors";
export type { ClinicOwnerInvitationActivation } from "~/server/db/clinic-owner-invitation-activation";

export type ClinicOwnerMembership = {
  active: true;
  clinicId: string;
  identityId: string;
  role: "doctor" | "owner";
};

export async function acceptClinicInvitation(
  input: { password: string; token: string },
  activation: ClinicOwnerInvitationActivation = drizzleClinicOwnerInvitationActivation,
): Promise<ClinicOwnerMembership> {
  if (input.password.length < 8 || input.password.length > 128) {
    await activation.recordFailedAttempt(input.token);
    throw new ClinicOwnerInvitationError();
  }

  return activation.accept(input);
}

/** Alias de compatibilidad para la activación del Médico propietario inicial. */
export const acceptClinicOwnerInvitation = acceptClinicInvitation;
