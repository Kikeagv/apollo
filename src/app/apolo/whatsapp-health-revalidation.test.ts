import { describe, expect, it } from "vitest";

import { shouldAutomaticallyRevalidateWhatsAppHealth } from "./whatsapp-health-revalidation";

describe("revalidación de salud de WhatsApp al abrir Supervisión", () => {
  it("revalida cuando Kapso no tiene una salud vigente para un número asociado", () => {
    expect(
      shouldAutomaticallyRevalidateWhatsAppHealth({
        activationVisible: true,
        health: "unknown",
        phoneNumberId: "phone-123",
        provider: "kapso",
      }),
    ).toBe(true);
  });

  it.each([
    {
      activationVisible: false,
      health: "unknown" as const,
      phoneNumberId: "phone-123",
      provider: "kapso" as const,
    },
    {
      activationVisible: true,
      health: "healthy" as const,
      phoneNumberId: "phone-123",
      provider: "kapso" as const,
    },
    {
      activationVisible: true,
      health: "unknown" as const,
      phoneNumberId: "phone-123",
      provider: "simulated" as const,
    },
    {
      activationVisible: true,
      health: "unknown" as const,
      phoneNumberId: null,
      provider: "kapso" as const,
    },
  ])("no revalida cuando no corresponde: %o", (input) => {
    expect(shouldAutomaticallyRevalidateWhatsAppHealth(input)).toBe(false);
  });
});
