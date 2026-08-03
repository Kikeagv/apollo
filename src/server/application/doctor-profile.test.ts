import { describe, expect, it, vi } from "vitest";

import {
  DoctorProfileAccessError,
  type DoctorProfileUpdater,
  completeOwnDoctorProfile,
} from "./doctor-profile";

describe("completar el perfil propio de Médico", () => {
  it("normaliza los datos públicos y deja una auditoría de configuración", async () => {
    const complete = vi.fn().mockResolvedValue({
      id: "doctor-1",
      primarySpecialty: "Medicina familiar",
      publicName: "Dra. Ana Reyes",
    });
    const updater: DoctorProfileUpdater = {
      complete,
    };

    await expect(
      completeOwnDoctorProfile(
        {
          clinicId: "clinic-1",
          identityId: "identity-1",
          primarySpecialty: "  Medicina familiar  ",
          publicName: "  Dra. Ana Reyes  ",
        },
        updater,
      ),
    ).resolves.toEqual({
      id: "doctor-1",
      primarySpecialty: "Medicina familiar",
      publicName: "Dra. Ana Reyes",
    });

    expect(complete).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      identityId: "identity-1",
      primarySpecialty: "Medicina familiar",
      publicName: "Dra. Ana Reyes",
    });
  });

  it("rechaza campos públicos vacíos sin intentar mutar el perfil", async () => {
    const complete = vi.fn();
    const updater: DoctorProfileUpdater = { complete };

    await expect(
      completeOwnDoctorProfile(
        {
          clinicId: "clinic-1",
          identityId: "identity-1",
          primarySpecialty: "Medicina familiar",
          publicName: "   ",
        },
        updater,
      ),
    ).rejects.toThrow("El nombre público es obligatorio");

    expect(complete).not.toHaveBeenCalled();
  });

  it("rechaza a una Secretaria o una Identidad sin perfil de Médico", async () => {
    const updater: DoctorProfileUpdater = {
      complete: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      completeOwnDoctorProfile(
        {
          clinicId: "clinic-1",
          identityId: "secretary-1",
          primarySpecialty: "Medicina familiar",
          publicName: "Secretaria sin perfil",
        },
        updater,
      ),
    ).rejects.toBeInstanceOf(DoctorProfileAccessError);
  });
});
