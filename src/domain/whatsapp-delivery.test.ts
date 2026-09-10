import { describe, expect, it } from "vitest";

import {
  buildTransactionalTemplateParameters,
  chooseTransactionalWhatsAppRoute,
  reconcileWhatsAppDeliveryStatus,
  retryAtFromKapsoHeaders,
} from "./whatsapp-delivery";

const now = new Date("2026-09-09T12:00:00.000Z");

describe("decisión de Entrega transaccional de WhatsApp", () => {
  it("congela fecha y hora administrativas con el locale de la Clínica", () => {
    expect(
      buildTransactionalTemplateParameters(["clinic_name", "date", "time"], {
        clinicName: "Clínica Central",
        startsAt: new Date("2026-09-10T00:00:00.000Z"),
      }),
    ).toEqual(["Clínica Central", "9 de septiembre de 2026", "6:00 p. m."]);
  });

  it("usa texto dentro de la Ventana de servicio y no intenta plantilla", () => {
    expect(
      chooseTransactionalWhatsAppRoute({
        now,
        serviceWindowExpiresAt: new Date("2026-09-09T20:00:00.000Z"),
        template: {
          locale: "es",
          name: "appointment_reminder",
          parameters: ["Ana"],
          providerTemplateId: "template-reminder",
        },
        text: "Tu cita es mañana a las 08:00.",
      }),
    ).toEqual({
      kind: "text",
      text: "Tu cita es mañana a las 08:00.",
    });
  });

  it("usa la plantilla Utility aprobada fuera de la Ventana", () => {
    expect(
      chooseTransactionalWhatsAppRoute({
        now,
        serviceWindowExpiresAt: new Date("2026-09-09T11:59:59.000Z"),
        template: {
          category: "UTILITY",
          locale: "es",
          name: "appointment_reminder",
          parameters: ["Ana", "Clínica Central"],
          providerTemplateId: "template-reminder",
          status: "APPROVED",
        },
        text: "Tu cita es mañana a las 08:00.",
      }),
    ).toEqual({
      kind: "template",
      locale: "es",
      name: "appointment_reminder",
      parameters: ["Ana", "Clínica Central"],
      providerTemplateId: "template-reminder",
    });
  });

  it("falla cerrado si fuera de ventana no existe una Utility aprobada", () => {
    expect(() =>
      chooseTransactionalWhatsAppRoute({
        now,
        serviceWindowExpiresAt: null,
        template: {
          category: "MARKETING",
          locale: "es",
          name: "appointment_reminder",
          parameters: [],
          providerTemplateId: "template-reminder",
          status: "APPROVED",
        },
        text: "Tu cita es mañana a las 08:00.",
      }),
    ).toThrow("Utility");
  });
});

describe("reconciliación de estados de Kapso", () => {
  it("no permite que un callback atrasado degrade delivered a sent", () => {
    expect(reconcileWhatsAppDeliveryStatus("delivered", "sent")).toBe(
      "delivered",
    );
    expect(reconcileWhatsAppDeliveryStatus("read", "delivered")).toBe("read");
  });

  it("conserva failed como estado terminal hasta que exista un nuevo intento", () => {
    expect(reconcileWhatsAppDeliveryStatus("failed", "sent")).toBe("failed");
    expect(reconcileWhatsAppDeliveryStatus("accepted", "failed")).toBe(
      "failed",
    );
  });

  it("ignora un fallo atrasado después de una entrega o lectura confirmada", () => {
    expect(reconcileWhatsAppDeliveryStatus("delivered", "failed")).toBe(
      "delivered",
    );
    expect(reconcileWhatsAppDeliveryStatus("read", "failed")).toBe("read");
  });
});

describe("backoff de Kapso", () => {
  it("honra Retry-After en segundos y conserva backoff exponencial cuando falta", () => {
    expect(
      retryAtFromKapsoHeaders({
        attempt: 2,
        headers: new Headers({ "Retry-After": "7" }),
        now,
      }),
    ).toEqual(new Date("2026-09-09T12:00:07.000Z"));
    expect(
      retryAtFromKapsoHeaders({
        attempt: 2,
        headers: new Headers(),
        now,
      }),
    ).toEqual(new Date("2026-09-09T12:02:00.000Z"));
  });
});
