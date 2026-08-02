import {
  drizzleClinicOwnerInvitationActivation,
  type ClinicOwnerInvitationActivation,
} from "~/server/db/clinic-owner-invitation-activation";

import { ClinicOwnerInvitationError } from "./clinic-owner-invitation-errors";

export { ClinicOwnerInvitationError } from "./clinic-owner-invitation-errors";

export type ClinicOwnerMembership = {
  active: true;
  clinicId: string;
  identityId: string;
  role: "owner";
};

export async function acceptClinicOwnerInvitation(
  input: { password: string; token: string },
  activation: ClinicOwnerInvitationActivation = drizzleClinicOwnerInvitationActivation,
): Promise<ClinicOwnerMembership> {
  if (input.password.length < 8 || input.password.length > 128) {
    await activation.recordFailedAttempt(input.token);
    throw new ClinicOwnerInvitationError();
  }

  return activation.accept(input);
}
