import { describe, expect, it } from "vitest";

import {
  acceptClinicInvitation,
  getClinicInvitationActivationMode,
  type ClinicOwnerInvitationActivation,
  type ClinicOwnerInvitationPreflight,
} from "./accept-clinic-owner-invitation";

describe("aceptar una invitación de Médico", () => {
  it("activa el perfil de Médico no propietario únicamente al aceptar el enlace", async () => {
    const activation: ClinicOwnerInvitationActivation = {
      accept: async () => ({
        active: true,
        clinicId: "clinic-1",
        identityId: "doctor-1",
        identityStatus: "created" as const,
        invitationStatus: "accepted" as const,
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
      identityStatus: "created",
      invitationStatus: "accepted",
      role: "doctor",
    });
  });

  it("permite aceptar una invitación existente sin reemplazar la contraseña", async () => {
    const inputs: Array<{ password?: string; token: string }> = [];
    const activation: ClinicOwnerInvitationActivation = {
      accept: async (input) => {
        inputs.push(input);
        return {
          active: true,
          clinicId: "clinic-1",
          identityId: "doctor-1",
          identityStatus: "existing" as const,
          invitationStatus: "accepted" as const,
          role: "owner" as const,
        };
      },
      recordFailedAttempt: async () => undefined,
    };

    await expect(
      acceptClinicInvitation({ token: "token-1" }, activation),
    ).resolves.toMatchObject({ identityStatus: "existing" });
    expect(inputs).toEqual([{ token: "token-1" }]);
  });

  it("expone el modo de activación desde un preflight autorizado", async () => {
    const preflight: ClinicOwnerInvitationPreflight = {
      preflight: async () => "new",
    };

    await expect(
      getClinicInvitationActivationMode({ token: "token-1" }, preflight),
    ).resolves.toBe("new");
  });
});
