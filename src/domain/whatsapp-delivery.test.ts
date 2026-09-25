import { describe, expect, it } from "vitest";

import {
  buildTransactionalTemplateParameters,
  chooseTransactionalWhatsAppRoute,
  formatTransactionalAppointmentText,
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

  it("prepara las variables canónicas aprobadas para mensajes de Cita", () => {
    expect(
      buildTransactionalTemplateParameters(
        [
          "patient_name",
          "clinic_name",
          "appointment_date",
          "appointment_time",
          "doctor_name",
        ],
        {
          clinicName: "Clínica Central",
          doctorName: "Dra. Ana Pérez",
          patientName: "Ana López",
          startsAt: new Date("2026-09-10T00:00:00.000Z"),
        },
      ),
    ).toEqual([
      "Ana López",
      "Clínica Central",
      "9 de septiembre de 2026",
      "6:00 p. m.",
      "Dra. Ana Pérez",
    ]);
  });

  it("prepara el texto mínimo de una reprogramación", () => {
    expect(
      formatTransactionalAppointmentText({
        clinicName: "Central",
        doctorName: "Dra. Ana Pérez",
        kind: "reschedule",
        startsAt: new Date("2026-09-10T00:00:00.000Z"),
      }),
    ).toBe(
      "Tu cita en la Clínica Central fue reprogramada para el 9 de septiembre de 2026 a las 6:00 p. m. con Dra. Ana Pérez.",
    );
  });

  it("descarta variables que podrían exponer contenido clínico o identificadores", () => {
    expect(
      buildTransactionalTemplateParameters(
        [
          "clinic_name",
          "date",
          "time",
          "doctor_name",
          "diagnosis",
          "results",
          "medications",
          "dui",
          "clinical_notes",
          "documents",
          "transcript",
        ],
        {
          clinicName: "Clínica Central",
          doctorName: "Dra. Ana Pérez",
          startsAt: new Date("2026-09-10T00:00:00.000Z"),
        },
      ),
    ).toEqual([
      "Clínica Central",
      "9 de septiembre de 2026",
      "6:00 p. m.",
      "Dra. Ana Pérez",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  });

  it("requiere la plantilla Utility aprobada incluso dentro de la Ventana", () => {
    expect(
      chooseTransactionalWhatsAppRoute({
        template: {
          category: "UTILITY",
          locale: "es",
          name: "appointment_reminder",
          parameters: ["Ana"],
          providerTemplateId: "template-reminder",
          status: "APPROVED",
        },
        text: "Tu cita es mañana a las 08:00.",
      }),
    ).toEqual({
      kind: "template",
      locale: "es",
      name: "appointment_reminder",
      parameters: ["Ana"],
      providerTemplateId: "template-reminder",
    });
  });

  it("usa la plantilla Utility aprobada fuera de la Ventana", () => {
    expect(
      chooseTransactionalWhatsAppRoute({
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

  it("acepta el locale exacto de la plantilla sincronizada del WABA", () => {
    expect(
      chooseTransactionalWhatsAppRoute({
        template: {
          category: "UTILITY",
          locale: "en_US",
          name: "appointment_reminder",
          parameters: ["Ana", "Clínica Central"],
          providerTemplateId: "template-reminder",
          status: "APPROVED",
        },
        text: "Your appointment is tomorrow at 08:00.",
      }),
    ).toEqual({
      kind: "template",
      locale: "en_US",
      name: "appointment_reminder",
      parameters: ["Ana", "Clínica Central"],
      providerTemplateId: "template-reminder",
    });
  });

  it("falla cerrado si fuera de ventana no existe una Utility aprobada", () => {
    expect(() =>
      chooseTransactionalWhatsAppRoute({
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
