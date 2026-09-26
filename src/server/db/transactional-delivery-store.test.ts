import { describe, expect, it } from "vitest";

import {
  shouldSuppressOffboardedWhatsAppDelivery,
  shouldSuppressWhatsAppReminder,
} from "./transactional-delivery-store";

describe("bloqueo de recordatorios proactivos", () => {
  it("suprime una entrega pendiente sin consentimiento vigente para que no se envíe tarde", () => {
    expect(
      shouldSuppressWhatsAppReminder({
        hasCurrentConsent: false,
        kind: "appointment-reminder",
        recipientContactId: "contact-1",
      }),
    ).toBe(true);
    expect(
      shouldSuppressWhatsAppReminder({
        hasCurrentConsent: true,
        kind: "appointment-reminder",
        recipientContactId: "contact-1",
      }),
    ).toBe(false);
  });
});

describe("offboarding de Entregas de WhatsApp", () => {
  it("suprime mensajes y recordatorios nuevos, sin afectar otras entregas", () => {
    expect(
      shouldSuppressOffboardedWhatsAppDelivery({
        connectionOffboarded: true,
        kind: "appointment-message",
      }),
    ).toBe(true);
    expect(
      shouldSuppressOffboardedWhatsAppDelivery({
        connectionOffboarded: true,
        kind: "appointment-reminder",
      }),
    ).toBe(true);
    expect(
      shouldSuppressOffboardedWhatsAppDelivery({
        connectionOffboarded: true,
        kind: "daily-agenda-pdf",
      }),
    ).toBe(false);
    expect(
      shouldSuppressOffboardedWhatsAppDelivery({
        connectionOffboarded: false,
        kind: "appointment-message",
      }),
    ).toBe(false);
  });
});
