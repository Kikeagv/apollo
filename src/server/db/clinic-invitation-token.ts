import { createHash } from "node:crypto";

/** Nunca se persiste el enlace de una Invitación de usuario de clínica. */
export function hashClinicInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
