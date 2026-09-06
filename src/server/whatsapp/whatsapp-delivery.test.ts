import { afterEach, describe, expect, it, vi } from "vitest";

const DEFAULT_ENV = {
  BETTER_AUTH_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://localhost:5432/panacea",
  KAPSO_API_KEY: "",
  KAPSO_WEBHOOK_SECRET: "",
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
    expect(delivery.whatsAppSender().appointmentMessageSender).not.toBe(
      simulated.simulatedAppointmentMessageSender,
    );
    expect(delivery.whatsAppSender().provider).toBe("simulated");
  });

  it("rechaza el modo Kapso sin secretos configurados", async () => {
    await expect(importFresh({ WHATSAPP_DELIVERY: "kapso" })).rejects.toThrow(
      /KAPSO_API_KEY.*KAPSO_WEBHOOK_SECRET/,
    );
  });

  it("selecciona Kapso cuando las credenciales del entorno están presentes", async () => {
    const { delivery, simulated } = await importFresh({
      KAPSO_API_KEY: "kapso-api-key-test",
      KAPSO_WEBHOOK_SECRET: "kapso-webhook-secret-test",
      WHATSAPP_DELIVERY: "kapso",
    });
    const sender = delivery.whatsAppSender();

    expect(sender.provider).toBe("kapso");
    expect(sender.appointmentMessageSender).not.toBe(
      simulated.simulatedAppointmentMessageSender,
    );
    expect(delivery.whatsAppProvider()).toBe("kapso");
    expect(JSON.stringify(sender)).not.toContain("kapso-api-key-test");
    expect(JSON.stringify(sender)).not.toContain("kapso-webhook-secret-test");
  });

  it("conserva la idempotencia del proveedor simulado", async () => {
    const { simulated } = await importFresh({});
    const reminder = {
      appointmentId: "appointment-idempotent",
      clinicId: "clinic-1",
      idempotencyKey: "appointment-idempotent:24h:contact-1",
      recipient: {
        id: "contact-1",
        name: "Ana",
        phoneE164: "+50370000001",
      },
    };
    const initialCount =
      simulated.getSentSimulatedAppointmentReminders().length;

    await simulated.simulatedAppointmentReminderSender.send(reminder);
    await simulated.simulatedAppointmentReminderSender.send(reminder);

    expect(simulated.getSentSimulatedAppointmentReminders()).toHaveLength(
      initialCount + 1,
    );
  });

  it("no mezcla secretos entre dos cargas de entorno", async () => {
    const configured = await importFresh({
      KAPSO_API_KEY: "kapso-api-key-test",
      KAPSO_WEBHOOK_SECRET: "kapso-webhook-secret-test",
      WHATSAPP_DELIVERY: "kapso",
    });
    expect(configured.delivery.whatsAppProvider()).toBe("kapso");

    const simulated = await importFresh({
      WHATSAPP_DELIVERY: "simulated",
    });
    expect(simulated.delivery.whatsAppProvider()).toBe("simulated");
    expect(simulated.delivery.whatsAppSender().provider).toBe("simulated");
  });
});
