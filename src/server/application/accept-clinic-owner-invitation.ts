import {
  drizzleClinicOwnerInvitationActivation,
  type ClinicOwnerInvitationActivation,
  type ClinicOwnerInvitationPreflight,
} from "~/server/db/clinic-owner-invitation-activation";
import type {
  ClinicInvitationAcceptance,
  ClinicInvitationActivationContext,
} from "~/domain/clinic-invitation";

import { ClinicOwnerInvitationError } from "./clinic-owner-invitation-errors";

export { ClinicOwnerInvitationError } from "./clinic-owner-invitation-errors";
export type {
  ClinicOwnerInvitationActivation,
  ClinicOwnerInvitationPreflight,
} from "~/server/db/clinic-owner-invitation-activation";

export type ClinicOwnerMembership = ClinicInvitationAcceptance;

export async function acceptClinicInvitation(
  input: { password?: string; token: string },
  activation: ClinicOwnerInvitationActivation = drizzleClinicOwnerInvitationActivation,
): Promise<ClinicOwnerMembership> {
  if (
    input.password !== undefined &&
    (input.password.length < 8 || input.password.length > 128)
  ) {
    await activation.recordFailedAttempt(input.token);
    throw new ClinicOwnerInvitationError();
  }

  return activation.accept(input);
}

/**
 * Identifica el formulario seguro para el portador de una invitación válida.
 * La consulta solo acepta el token como autorización y devuelve un error
 * genérico cuando el enlace no existe o ya venció.
 */
export async function getClinicInvitationActivationMode(
  input: { token: string },
  preflight: ClinicOwnerInvitationPreflight = drizzleClinicOwnerInvitationActivation,
): Promise<ClinicInvitationActivationContext> {
  return preflight.preflight(input.token);
}

/** Alias de compatibilidad para la activación del Médico propietario inicial. */
export const acceptClinicOwnerInvitation = acceptClinicInvitation;
