import { describe, expect, it } from "vitest";

import { canAccessPanaceaTechnicalSurface } from "./panacea-technical-surface";

describe("superficie técnica de Panacea", () => {
  it("solo está disponible para el propietario fuera de producción", () => {
    expect(
      canAccessPanaceaTechnicalSurface({ nodeEnv: "test", role: "owner" }),
    ).toBe(true);
    expect(
      canAccessPanaceaTechnicalSurface({ nodeEnv: "test", role: "doctor" }),
    ).toBe(false);
    expect(
      canAccessPanaceaTechnicalSurface({
        nodeEnv: "test",
        role: "secretary",
      }),
    ).toBe(false);
    expect(
      canAccessPanaceaTechnicalSurface({
        nodeEnv: "production",
        role: "owner",
      }),
    ).toBe(false);
  });
});
