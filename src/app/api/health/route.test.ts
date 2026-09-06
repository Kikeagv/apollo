import { describe, expect, it } from "vitest";

import type { WhatsAppRuntimeDiagnostic } from "~/domain/whatsapp-runtime";
import { createHealthResponse } from "./health-response";

describe("health check del runtime", () => {
  it("mantiene 200 para el modo simulado", async () => {
    const response = createHealthResponse({
      apiKey: "not-required",
      configured: true,
      missing: [],
      provider: "simulated",
      webhookSecret: "not-required",
    } satisfies WhatsAppRuntimeDiagnostic);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(
      '{"status":"ok","whatsapp":{"configured":true,"provider":"simulated"}}',
    );
  });

  it("falla de forma explícita si Kapso está activo sin secretos", async () => {
    const response = createHealthResponse({
      apiKey: "not-configured",
      configured: false,
      missing: ["KAPSO_API_KEY", "KAPSO_WEBHOOK_SECRET"],
      provider: "kapso",
      webhookSecret: "not-configured",
    } satisfies WhatsAppRuntimeDiagnostic);

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toBe(
      '{"reason":"whatsapp-runtime-not-configured","status":"error","whatsapp":{"configured":false,"provider":"kapso"}}',
    );
    expect(body).not.toContain("KAPSO_API_KEY");
    expect(body).not.toContain("KAPSO_WEBHOOK_SECRET");
  });
});
