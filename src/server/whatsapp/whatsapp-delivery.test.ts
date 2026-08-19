import { afterEach, describe, expect, it, vi } from "vitest";

const DEFAULT_ENV = {
  BETTER_AUTH_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://localhost:5432/panacea",
  WHATSAPP_DELIVERY: "simulated",
};

/**
 * Re-evalúa el módulo del selector sobre un grafo fresco para que el guard
 * de arranque vea el env stubeado; los imports dinámicos son un límite de
 * carga de módulos a propósito (el guard corre al importar).
 */
async function importFresh(overrides: Record<string, string>) {
  for (const [key, value] of Object.entries({ ...DEFAULT_ENV, ...overrides })) {
    vi.stubEnv(key, value);
  }
  vi.resetModules();
  const delivery = await import("./whatsapp-delivery");
  const simulated = await import("./simulated-appointment-messages");
  return { delivery, simulated };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("whatsAppSender", () => {
  it("devuelve el adaptador simulado por defecto", async () => {
    const { delivery, simulated } = await importFresh({});
    expect(delivery.whatsAppSender().appointmentMessageSender).toBe(
      simulated.simulatedAppointmentMessageSender,
    );
  });

  it("rechaza el modo twilio sin secretos configurados", async () => {
    await expect(importFresh({ WHATSAPP_DELIVERY: "twilio" })).rejects.toThrow(
      /TWILIO_ACCOUNT_SID/,
    );
  });

  it("selecciona el adaptador de Twilio cuando hay secretos", async () => {
    const { delivery, simulated } = await importFresh({
      WHATSAPP_DELIVERY: "twilio",
      TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
      TWILIO_AUTH_TOKEN: "clave-de-prueba",
      TWILIO_WHATSAPP_FROM: "+50370000001",
    });
    expect(delivery.whatsAppSender().appointmentMessageSender).not.toBe(
      simulated.simulatedAppointmentMessageSender,
    );
  });
});
