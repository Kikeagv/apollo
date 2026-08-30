import { describe, expect, it, vi } from "vitest";

import {
  listPanaceaTeam,
  PanaceaTeamAccessError,
  type PanaceaTeamReader,
} from "./panacea-team";

describe("Equipo de Panacea", () => {
  it("devuelve perfiles, progreso e invitaciones para el propietario", async () => {
    const reader: PanaceaTeamReader = {
      read: vi.fn().mockResolvedValue({
        doctors: [
          {
            active: true,
            email: "ana@aurora.test",
            id: "doctor-1",
            name: "Dra. Ana Reyes",
            primarySpecialty: null,
            publicName: "Dra. Ana Reyes",
            role: "owner",
          },
        ],
        invitations: [
          {
            email: "luis@aurora.test",
            expiresAt: new Date("2026-09-01T12:00:00Z"),
            id: "invitation-1",
            recipientName: "Dr. Luis Pérez",
            status: "pending",
          },
        ],
      }),
    };

    await expect(
      listPanaceaTeam({ clinicId: "clinic-1", identityId: "owner-1" }, reader),
    ).resolves.toEqual({
      doctors: [
        expect.objectContaining({
          id: "doctor-1",
          profile: {
            completedSteps: 1,
            status: "incomplete",
            totalSteps: 2,
          },
        }),
      ],
      invitations: [
        expect.objectContaining({
          email: "luis@aurora.test",
          status: "pending",
        }),
      ],
    });
  });

  it("rechaza la lectura del Equipo fuera del propietario", async () => {
    const reader: PanaceaTeamReader = {
      read: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      listPanaceaTeam({ clinicId: "clinic-1", identityId: "doctor-1" }, reader),
    ).rejects.toBeInstanceOf(PanaceaTeamAccessError);
  });
});
