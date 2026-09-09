import { describe, expect, it } from "vitest";

import { shouldSuppressWhatsAppReminder } from "./transactional-delivery-store";

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
