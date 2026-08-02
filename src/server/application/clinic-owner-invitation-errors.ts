export class ClinicOwnerInvitationError extends Error {
  constructor() {
    super("La invitación no es válida o venció");
  }
}
