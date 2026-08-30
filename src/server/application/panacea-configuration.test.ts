import { describe, expect, it, vi } from "vitest";

import {
  getPanaceaConfigurationOverview,
  PanaceaConfigurationAccessError,
  type PanaceaConfigurationReader,
} from "./panacea-configuration";

describe("índice operativo de Configuración", () => {
  it("calcula el estado de cada área desde el lector de capacidad", async () => {
    const read = vi.fn().mockResolvedValue({
      availability: { activeSchedules: 1, futureCareOptions: 2 },
      services: { activeOffers: 1, activeServices: 1 },
      team: { activeDoctors: 1, completedProfiles: 1, pendingInvitations: 0 },
      whatsapp: { configured: false },
    });
    const reader: PanaceaConfigurationReader = {
      read,
    };

    const overview = await getPanaceaConfigurationOverview(
      { clinicId: "clinic-1", identityId: "owner-1" },
      reader,
    );
    expect(overview.areas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "team", status: "complete" }),
        expect.objectContaining({ id: "availability", status: "complete" }),
      ]),
    );
    expect(read).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      identityId: "owner-1",
    });
  });

  it("no expone el índice si la membresía no tiene alcance de Configuración", async () => {
    const reader: PanaceaConfigurationReader = {
      read: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      getPanaceaConfigurationOverview(
        { clinicId: "clinic-1", identityId: "secretary-1" },
        reader,
      ),
    ).rejects.toBeInstanceOf(PanaceaConfigurationAccessError);
  });
});
