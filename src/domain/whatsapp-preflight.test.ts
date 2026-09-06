import { describe, expect, it } from "vitest";

import {
  evaluateKapsoWhatsAppPreflight,
  type KapsoWhatsAppPreflightInput,
} from "./whatsapp-preflight";

const validInput = (
  overrides: Partial<KapsoWhatsAppPreflightInput> = {},
): KapsoWhatsAppPreflightInput => ({
  clinicName: "Clínica Aurora",
  metaAuthority: "confirmed",
  numberAssociation: "available",
  numberOwnedByClinic: true,
  ownerConfirmed: true,
  ownerName: "Dra. Ana Reyes",
  phoneNumberE164: "+50370000000",
  qrDeviceAvailable: true,
  whatsappBusinessApp: "active",
  ...overrides,
});

describe("preflight de WhatsApp con Kapso", () => {
  it("aprueba una Clínica preparada para el siguiente paso", () => {
    expect(evaluateKapsoWhatsAppPreflight(validInput())).toEqual({
      blockers: [],
      nextAction: "Generar el Enlace de configuración de WhatsApp",
      status: "passed",
    });
  });

  it.each([
    [
      "without WhatsApp Business App",
      { whatsappBusinessApp: "not-installed" as const },
      "Instala y activa WhatsApp Business App con el número propio de la Clínica.",
    ],
    [
      "with personal WhatsApp Messenger",
      { whatsappBusinessApp: "messenger-only" as const },
      "Migra voluntariamente el número a WhatsApp Business App o aporta otra línea.",
    ],
    [
      "without Meta authority",
      { metaAuthority: "not-confirmed" as const },
      "Invita al responsable con acceso al Business Portfolio/WABA para completar la autorización.",
    ],
    [
      "without a QR device",
      { qrDeviceAvailable: false },
      "Ten a mano un dispositivo capaz de mostrar y completar el QR de coexistence.",
    ],
    [
      "with a number associated to another customer",
      { numberAssociation: "other-customer" as const },
      "Resuelve la asociación del número con el otro customer; Praxia no desconecta terceros.",
    ],
  ])("bloquea %s con una acción concreta", (_scenario, overrides, action) => {
    const result = evaluateKapsoWhatsAppPreflight(validInput(overrides));

    expect(result.status).toBe("blocked");
    expect(result.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ nextAction: action })]),
    );
    expect(result.nextAction).toBe(action);
  });

  it("bloquea datos de la Clínica, propietario y número incompletos", () => {
    const result = evaluateKapsoWhatsAppPreflight(
      validInput({
        clinicName: " ",
        numberOwnedByClinic: false,
        ownerConfirmed: false,
        ownerName: " ",
        phoneNumberE164: "not-a-phone",
      }),
    );

    expect(result.status).toBe("blocked");
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      "clinic-data-incomplete",
      "owner-not-confirmed",
      "phone-number-invalid",
      "phone-number-not-owned",
    ]);
  });
});
