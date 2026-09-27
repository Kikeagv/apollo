import { describe, expect, it } from "vitest";

import {
  evaluateClinicSupervision,
  type ClinicSupervisionInput,
} from "./clinic-supervision";

const readyInput: ClinicSupervisionInput = {
  clinic: {
    id: "clinic-109",
    isSynthetic: false,
    name: "Clínica Central",
    subscriptionStatus: "active",
  },
  owner: {
    access: "ready",
    invitationCanRetry: false,
    invitationDelivery: "succeeded",
    name: "Dra. Central",
  },
  connection: {
    status: "ready",
    technicalStatus: "ready",
    readinessReason: "Todos los gates técnicos están correctos",
    nextAction: null,
    firstIncompleteGate: null,
  },
  capacity: {
    billingGate: {
      status: "ready",
      message:
        "Billing partner_managed, crédito y cargos separados verificados",
      action: "",
    },
    creditCents: 12500,
    creditReserveCents: 2500,
    quotaConsumed: 120,
    quotaReserved: 4,
    quotaInFlight: 2,
    monthlyQuota: 500,
    circuit: {
      status: "closed",
      cause: null,
      reason: "Circuito cerrado",
      nextAction: "La Conexión opera normalmente",
    },
    trafficStatus: "enabled",
    trafficAllowed: true,
    trafficBlocker: null,
  },
};

describe("resumen de supervisión de Clínica", () => {
  it("distingue acceso, suscripción, conexión y capacidad con mensajería habilitada", () => {
    const summary = evaluateClinicSupervision(readyInput);

    expect(summary.clinic.name).toBe("Clínica Central");
    expect(summary.states.map(({ key, status }) => [key, status])).toEqual([
      ["owner-access", "ready"],
      ["subscription", "ready"],
      ["whatsapp-connection", "ready"],
      ["messaging-capacity", "ready"],
    ]);
    expect(summary.messagingMode).toBe("enabled");
  });

  it("explica el acceso pendiente y permite reintentar una invitación fallida", () => {
    const summary = evaluateClinicSupervision({
      ...readyInput,
      owner: {
        access: "pending",
        invitationCanRetry: true,
        invitationDelivery: "failed",
        name: "Dra. Central",
      },
    });

    expect(summary.states[0]).toMatchObject({
      key: "owner-access",
      status: "attention",
      cause: "Falló el último envío de la invitación del Médico propietario.",
      responsible: "Equipo de identidad",
      nextAction: "Reenviar la invitación de acceso.",
      action: "retry-owner-invitation",
    });
  });

  it("permite recuperar una invitación expirada sin acceso activo", () => {
    const summary = evaluateClinicSupervision({
      ...readyInput,
      owner: {
        access: "blocked",
        invitationCanRetry: true,
        invitationDelivery: "succeeded",
        name: "Dra. Central",
      },
    });

    expect(summary.states[0]).toMatchObject({
      status: "attention",
      action: "retry-owner-invitation",
      nextAction: "Reenviar la invitación de acceso.",
    });
  });

  it("usa la primera causa y acción canónicas de la Conexión", () => {
    const summary = evaluateClinicSupervision({
      ...readyInput,
      connection: {
        status: "pending",
        technicalStatus: "pending",
        readinessReason: "La sincronización de plantillas está pendiente",
        nextAction: "Reintentar el catálogo de plantillas",
        firstIncompleteGate: {
          code: "templates",
          message: "El WABA todavía no tiene las plantillas críticas",
          action: "Reintentar la sincronización de plantillas",
        },
      },
    });

    expect(summary.states[2]).toMatchObject({
      key: "whatsapp-connection",
      status: "pending",
      cause: "El WABA todavía no tiene las plantillas críticas",
      responsible: "Equipo de activación de WhatsApp",
      nextAction: "Reintentar la sincronización de plantillas",
    });
  });

  it("mantiene capacidad, autorización de tráfico y suscripción como estados separados", () => {
    const summary = evaluateClinicSupervision({
      ...readyInput,
      clinic: {
        ...readyInput.clinic,
        isSynthetic: true,
        subscriptionStatus: "suspended",
      },
      capacity: {
        ...readyInput.capacity,
        trafficStatus: "blocked",
        trafficAllowed: false,
        trafficBlocker: {
          code: "clinic-synthetic",
          message: "Una Clínica sintética no puede recibir tráfico real",
        },
      },
    });

    expect(summary.states[1]).toMatchObject({ status: "blocked" });
    expect(summary.states[3]).toMatchObject({ status: "ready" });
    expect(summary.messagingMode).toBe("synthetic-only");
    expect(summary.messagingModeReason).toBe(
      "Una Clínica sintética no puede recibir tráfico real",
    );
  });

  it("muestra como bloqueo de capacidad un circuito abierto sin inferirlo en la UI", () => {
    const summary = evaluateClinicSupervision({
      ...readyInput,
      capacity: {
        ...readyInput.capacity,
        circuit: {
          status: "open",
          cause: "quota-exhausted",
          reason: "La cuota mensual está agotada",
          nextAction: "Aumentar la cuota de Kapso",
        },
      },
    });

    expect(summary.states[3]).toMatchObject({
      status: "blocked",
      cause: "La cuota mensual está agotada",
      responsible: "Equipo de pagos",
      nextAction: "Aumentar la cuota de Kapso",
    });
  });

  it("envía un corte técnico a WhatsApp y uno de cuota a pagos", () => {
    const summary = evaluateClinicSupervision({
      ...readyInput,
      capacity: {
        ...readyInput.capacity,
        circuit: {
          status: "open",
          cause: "provider-error",
          reason: "El proveedor no acepta entregas",
          nextAction: "Revisar la integración con Kapso",
        },
      },
    });

    expect(summary.states[3]).toMatchObject({
      destination: "whatsapp",
      action: "open-whatsapp",
      responsible: "Equipo de operaciones WhatsApp",
    });
  });
});
