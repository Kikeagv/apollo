import { describe, expect, it } from "vitest";

import { doctorProfileProgress } from "./panacea-team";

describe("progreso del perfil de Médico", () => {
  it("separa los pasos completos de los que todavía requieren acción", () => {
    expect(
      doctorProfileProgress({
        primarySpecialty: null,
        publicName: "Dra. Ana Reyes",
      }),
    ).toEqual({
      completedSteps: 1,
      status: "incomplete",
      totalSteps: 2,
    });
  });

  it("marca completo solo el perfil con nombre público y especialidad", () => {
    expect(
      doctorProfileProgress({
        primarySpecialty: "Medicina familiar",
        publicName: "Dra. Ana Reyes",
      }),
    ).toEqual({
      completedSteps: 2,
      status: "complete",
      totalSteps: 2,
    });
  });
});
