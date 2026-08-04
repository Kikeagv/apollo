import { describe, expect, it, vi } from "vitest";

import {
  deactivateDoctor,
  DoctorDeactivationAccessError,
  type DoctorDeactivator,
} from "./doctor-status";

describe("desactivar un Médico", () => {
  it("marca inactivo al Médico sin borrar su perfil histórico", async () => {
    const deactivate = vi.fn().mockResolvedValue({
      active: false,
      id: "doctor-1",
      primarySpecialty: "Medicina familiar",
      publicName: "Dra. Rivera",
    });
    const store: DoctorDeactivator = { deactivate };

    await expect(
      deactivateDoctor(
        {
          clinicId: "clinic-1",
          doctorId: "doctor-1",
          identityId: "owner-1",
        },
        store,
      ),
    ).resolves.toMatchObject({ active: false, id: "doctor-1" });

    expect(deactivate).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      doctorId: "doctor-1",
      identityId: "owner-1",
    });
  });

  it("rechaza la desactivación que el propietario no puede realizar", async () => {
    await expect(
      deactivateDoctor(
        {
          clinicId: "clinic-1",
          doctorId: "doctor-1",
          identityId: "doctor-2",
        },
        { deactivate: vi.fn().mockResolvedValue(undefined) },
      ),
    ).rejects.toBeInstanceOf(DoctorDeactivationAccessError);
  });
});
