import { describe, expect, it } from "vitest";

import {
  canTransitionWhatsAppConnection,
  createSimulatedWhatsAppConnection,
  isWhatsAppConnectionReady,
  publicWhatsAppConnectionMetadata,
  simulatedWhatsAppPhoneE164,
  whatsappConnectionNextAction,
  whatsappConnectionStatusLabel,
} from "./whatsapp-connection";

describe("Conexión de WhatsApp por Clínica", () => {
  it("crea una conexión simulada lista con un número sintético y sin secretos externos", () => {
    const now = new Date("2026-09-05T12:00:00.000Z");

    expect(createSimulatedWhatsAppConnection("clinic-1", now)).toEqual({
      clinicId: "clinic-1",
      connectionType: "simulated",
      createdAt: now,
      customer: "simulated:clinic-1",
      lastTestAt: now,
      metadata: { mode: "simulated" },
      phoneNumberE164: simulatedWhatsAppPhoneE164("clinic-1"),
      phoneNumberId: null,
      provider: "simulated",
      status: "ready",
      updatedAt: now,
    });
  });

  it("expone el siguiente paso operativo según el estado", () => {
    expect(whatsappConnectionStatusLabel("pending")).toBe("Pendiente");
    expect(
      whatsappConnectionNextAction({
        connectionType: "coexistence",
        status: "pending",
      }),
    ).toBe("Completar el enlace de configuración");
    expect(
      whatsappConnectionNextAction({
        connectionType: "simulated",
        status: "ready",
      }),
    ).toBe("Modo simulado listo");
    expect(
      whatsappConnectionNextAction({
        connectionType: "simulated",
        lastTestAt: null,
        status: "ready",
      }),
    ).toBe("Ejecutar una prueba simulada");
    expect(
      whatsappConnectionNextAction({
        connectionType: "coexistence",
        status: "blocked",
      }),
    ).toBe("Reactivar la conexión manualmente");
  });

  it("solo autoriza envíos cuando la conexión está lista", () => {
    expect(isWhatsAppConnectionReady("ready")).toBe(true);
    expect(isWhatsAppConnectionReady("degraded")).toBe(false);
    expect(isWhatsAppConnectionReady("blocked")).toBe(false);
  });

  it("solo publica metadatos operativos permitidos", () => {
    expect(
      publicWhatsAppConnectionMetadata({
        apiKey: "no-debe-salir",
        health: "ok",
        mode: "simulated",
        webhookSecret: "tampoco-debe-salir",
      }),
    ).toEqual({ health: "ok", mode: "simulated" });
  });

  it("conserva transiciones explícitas y rechaza saltos no operativos", () => {
    expect(canTransitionWhatsAppConnection("pending", "provisioning")).toBe(
      true,
    );
    expect(canTransitionWhatsAppConnection("provisioning", "ready")).toBe(true);
    expect(canTransitionWhatsAppConnection("ready", "degraded")).toBe(true);
    expect(canTransitionWhatsAppConnection("pending", "ready")).toBe(false);
    expect(canTransitionWhatsAppConnection("disconnected", "blocked")).toBe(
      false,
    );
  });
});
