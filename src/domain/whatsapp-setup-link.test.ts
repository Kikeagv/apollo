import { describe, expect, it } from "vitest";

import {
  hasWhatsAppSetupLinkPolicyExpiry,
  isWhatsAppSetupLinkUsable,
  setupLinkExpiresAt,
  whatsappSetupLinkNextAction,
  whatsappSetupLinkStatus,
  whatsappSetupLinkStatusLabel,
} from "./whatsapp-setup-link";

describe("Enlace de configuración de WhatsApp", () => {
  it("vence 30 días después de su creación", () => {
    const createdAt = new Date("2026-09-07T12:00:00.000Z");
    const expiresAt = setupLinkExpiresAt(createdAt);

    expect(expiresAt).toEqual(new Date("2026-10-07T12:00:00.000Z"));
    expect(hasWhatsAppSetupLinkPolicyExpiry(createdAt, expiresAt)).toBe(true);
    expect(
      hasWhatsAppSetupLinkPolicyExpiry(
        createdAt,
        new Date("2026-10-08T12:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("expone un enlace activo antes del vencimiento", () => {
    const link = {
      expiresAt: new Date("2026-10-07T12:00:00.000Z"),
      status: "active" as const,
    };

    expect(
      whatsappSetupLinkStatus(link, new Date("2026-10-01T12:00:00.000Z")),
    ).toBe("active");
    expect(
      isWhatsAppSetupLinkUsable(link, new Date("2026-10-01T12:00:00.000Z")),
    ).toBe(true);
    expect(
      whatsappSetupLinkNextAction(link, new Date("2026-10-01T12:00:00.000Z")),
    ).toBe("Completar el enlace de configuración");
  });

  it("muestra vencimiento y regeneración como siguiente acción", () => {
    const link = {
      expiresAt: new Date("2026-10-07T12:00:00.000Z"),
      status: "active" as const,
    };

    expect(
      whatsappSetupLinkStatus(link, new Date("2026-10-07T12:00:00.001Z")),
    ).toBe("expired");
    expect(
      isWhatsAppSetupLinkUsable(link, new Date("2026-10-07T12:00:00.001Z")),
    ).toBe(false);
    expect(
      whatsappSetupLinkNextAction(link, new Date("2026-10-07T12:00:00.001Z")),
    ).toBe("Regenerar el enlace de configuración");
    expect(whatsappSetupLinkStatusLabel("revoked")).toBe("Revocado");
  });
});
