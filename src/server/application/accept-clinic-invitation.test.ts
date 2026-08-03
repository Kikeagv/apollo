import { describe, expect, it } from "vitest";

import {
  acceptClinicInvitation,
  type ClinicOwnerInvitationActivation,
} from "./accept-clinic-owner-invitation";

describe("aceptar una invitación de Médico", () => {
  it("activa el perfil de Médico no propietario únicamente al aceptar el enlace", async () => {
    const activation: ClinicOwnerInvitationActivation = {
      accept: async () => ({
        active: true,
        clinicId: "clinic-1",
        identityId: "doctor-1",
        role: "doctor",
      }),
      recordFailedAttempt: async () => undefined,
    };

    await expect(
      acceptClinicInvitation(
        { password: "Contraseña-segura", token: "token-1" },
        activation,
      ),
    ).resolves.toEqual({
      active: true,
      clinicId: "clinic-1",
      identityId: "doctor-1",
      role: "doctor",
    });
  });
});
