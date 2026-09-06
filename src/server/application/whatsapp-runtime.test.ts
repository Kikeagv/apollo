import { describe, expect, it, vi } from "vitest";

import {
  getWhatsAppRuntimeDiagnostic,
  type WhatsAppRuntimeDiagnosticReader,
} from "./whatsapp-runtime";

describe("diagnóstico operativo del runtime de WhatsApp", () => {
  it("consulta el diagnóstico mediante el lector autorizado", async () => {
    const read = vi.fn().mockResolvedValue({
      apiKey: "not-required",
      configured: true,
      missing: [],
      provider: "simulated",
      webhookSecret: "not-required",
    });
    const reader: WhatsAppRuntimeDiagnosticReader = { read };

    await expect(
      getWhatsAppRuntimeDiagnostic({ identityId: "superadmin-1" }, reader),
    ).resolves.toEqual({
      apiKey: "not-required",
      configured: true,
      missing: [],
      provider: "simulated",
      webhookSecret: "not-required",
    });
    expect(read).toHaveBeenCalledWith({ identityId: "superadmin-1" });
  });
});
