import { describe, expect, it } from "vitest";

import { isAdultPatient } from "./patient";

describe("mayoría de edad del Paciente", () => {
  it("se cumple desde el cumpleaños 18 en UTC", () => {
    expect(
      isAdultPatient("2008-09-20", new Date("2026-09-19T23:59:59.999Z")),
    ).toBe(false);
    expect(
      isAdultPatient("2008-09-20", new Date("2026-09-20T00:00:00.000Z")),
    ).toBe(true);
  });
});
