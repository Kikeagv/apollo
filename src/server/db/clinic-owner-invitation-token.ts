import { createHash } from "node:crypto";

export function hashClinicOwnerInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
