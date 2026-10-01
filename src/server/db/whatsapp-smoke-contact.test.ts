import { describe, expect, it } from "vitest";

import { isWhatsAppSmokeContactEligible } from "~/server/db/whatsapp-smoke-contact";

describe("elegibilidad del Contacto controlado de WhatsApp", () => {
  it("permite un Contacto todavía no vinculado a Pacientes", () => {
    expect(isWhatsAppSmokeContactEligible([])).toBe(true);
  });

  it("permite un Contacto vinculado solo a Pacientes de prueba", () => {
    expect(isWhatsAppSmokeContactEligible([{ isTest: true }])).toBe(true);
  });

  it("rechaza el Contacto si uno de sus Pacientes es real", () => {
    expect(
      isWhatsAppSmokeContactEligible([{ isTest: true }, { isTest: false }]),
    ).toBe(false);
  });
});
