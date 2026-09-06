import { describe, expect, it } from "vitest";

import {
  assertWhatsAppRuntimeReady,
  diagnoseWhatsAppRuntime,
} from "./whatsapp-runtime";

describe("configuración del runtime de WhatsApp", () => {
  it("mantiene el modo simulado configurado sin credenciales de Kapso", () => {
    expect(diagnoseWhatsAppRuntime({ provider: "simulated" })).toEqual({
      apiKey: "not-required",
      configured: true,
      missing: [],
      provider: "simulated",
      webhookSecret: "not-required",
    });

    expect(() =>
      assertWhatsAppRuntimeReady({ provider: "simulated" }),
    ).not.toThrow();
  });

  it("identifica cada credencial ausente sin devolver sus valores", () => {
    const diagnostic = diagnoseWhatsAppRuntime({
      kapsoApiKey: "",
      provider: "kapso",
      webhookSecret: undefined,
    });

    expect(diagnostic).toEqual({
      apiKey: "not-configured",
      configured: false,
      missing: ["KAPSO_API_KEY", "KAPSO_WEBHOOK_SECRET"],
      provider: "kapso",
      webhookSecret: "not-configured",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("kapso-api-key");
    expect(JSON.stringify(diagnostic)).not.toContain("webhook-secret");
    expect(() =>
      assertWhatsAppRuntimeReady({
        kapsoApiKey: "",
        provider: "kapso",
        webhookSecret: undefined,
      }),
    ).toThrow("KAPSO_API_KEY");
  });

  it("considera listo Kapso cuando están presentes ambos secretos", () => {
    const diagnostic = diagnoseWhatsAppRuntime({
      kapsoApiKey: "kapso-api-key-test",
      provider: "kapso",
      webhookSecret: "kapso-webhook-secret-test",
    });

    expect(diagnostic).toEqual({
      apiKey: "configured",
      configured: true,
      missing: [],
      provider: "kapso",
      webhookSecret: "configured",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("kapso-api-key-test");
    expect(JSON.stringify(diagnostic)).not.toContain(
      "kapso-webhook-secret-test",
    );
    expect(() =>
      assertWhatsAppRuntimeReady({
        kapsoApiKey: "kapso-api-key-test",
        provider: "kapso",
        webhookSecret: "kapso-webhook-secret-test",
      }),
    ).not.toThrow();
  });

  it("reporta una sola credencial ausente sin revelar la que sí existe", () => {
    const diagnostic = diagnoseWhatsAppRuntime({
      kapsoApiKey: "kapso-api-key-test",
      provider: "kapso",
      webhookSecret: "  ",
    });

    expect(diagnostic).toEqual({
      apiKey: "configured",
      configured: false,
      missing: ["KAPSO_WEBHOOK_SECRET"],
      provider: "kapso",
      webhookSecret: "not-configured",
    });
    expect(() =>
      assertWhatsAppRuntimeReady({
        kapsoApiKey: "kapso-api-key-test",
        provider: "kapso",
        webhookSecret: "  ",
      }),
    ).toThrow("KAPSO_WEBHOOK_SECRET");
  });
});
