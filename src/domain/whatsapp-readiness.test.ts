import { describe, expect, it } from "vitest";

import {
  currentWhatsAppNumberHealth,
  evaluateWhatsAppReadiness,
  getWhatsAppReadinessGeneration,
  isSameWhatsAppReadinessGeneration,
  isWhatsAppNumberSmokeCheckAllowed,
  whatsappCriticalTemplateCatalog,
  type WhatsAppReadinessInput,
  type WhatsAppTemplateSnapshot,
} from "./whatsapp-readiness";

const now = new Date("2026-09-07T12:00:00.000Z");

describe("salud del número para el smoke controlado", () => {
  it("permite un intento de prueba si la salud es desconocida", () => {
    expect(isWhatsAppNumberSmokeCheckAllowed("unknown")).toBe(true);
  });

  it("bloquea el intento de prueba ante una salud conocida no disponible", () => {
    expect(isWhatsAppNumberSmokeCheckAllowed("degraded")).toBe(false);
    expect(isWhatsAppNumberSmokeCheckAllowed("unhealthy")).toBe(false);
    expect(isWhatsAppNumberSmokeCheckAllowed("error")).toBe(false);
  });
});

function approvedTemplates(
  overrides: Partial<WhatsAppTemplateSnapshot> = {},
): WhatsAppTemplateSnapshot[] {
  return whatsappCriticalTemplateCatalog.map((template) => ({
    category: template.category,
    kind: template.kind,
    locale: template.locale,
    name: template.name,
    providerTemplateId: `kapso-${template.kind}`,
    rejectionReason: null,
    status: "APPROVED" as const,
    syncedAt: now,
    variables: [...template.variables],
    ...(overrides.kind === undefined || overrides.kind === template.kind
      ? overrides
      : {}),
  }));
}

function readyInput(
  overrides: Partial<WhatsAppReadinessInput> = {},
): WhatsAppReadinessInput {
  return {
    billing: {
      alertThresholdCents: 1_000,
      chargesSeparated: true,
      consumedCents: 2_000,
      creditCents: 10_000,
      mode: "partner_managed",
      status: "ready",
    },
    connection: {
      businessAccountId: "waba-1",
      connectionType: "coexistence",
      phoneNumberId: "phone-1",
      provider: "kapso",
      status: "provisioning",
    },
    e2e: {
      evidence: "Kapso respondió correctamente",
      evidenceScope: "message-roundtrip",
      lastTestAt: now,
      status: "passed",
    },
    number: {
      environment: "production",
      health: "healthy",
      healthCheckedAt: now,
    },
    templatesSync: { status: "ready" },
    templates: approvedTemplates(),
    webhooks: {
      phoneNumber: { status: "ready" },
      project: { status: "ready" },
    },
    ...overrides,
  };
}

describe("readiness técnico de la Conexión de WhatsApp", () => {
  it("acepta un número dedicated con todos los gates técnicos listos", () => {
    const input = readyInput();
    expect(
      evaluateWhatsAppReadiness({
        ...input,
        connection: { ...input.connection, connectionType: "dedicated" },
        now,
      }).status,
    ).toBe("ready");
  });

  it("trata salud sin timestamp como desconocida", () => {
    expect(
      currentWhatsAppNumberHealth({
        health: "unhealthy",
        healthCheckedAt: null,
      }),
    ).toBe("unknown");
  });

  it("considera el número, WABA, proyecto y evento como una sola generación", () => {
    const first = getWhatsAppReadinessGeneration({
      businessAccountId: "waba-1",
      metadata: {
        projectId: "project-1",
        provisioningEventId: "event-1",
      },
      phoneNumberId: "phone-1",
    });

    expect(first).toEqual({
      businessAccountId: "waba-1",
      phoneNumberId: "phone-1",
      projectId: "project-1",
      provisioningEventId: "event-1",
    });
    expect(
      isSameWhatsAppReadinessGeneration(first, {
        ...first,
        provisioningEventId: "event-2",
      }),
    ).toBe(false);
  });

  it("declara ready con número, webhooks, plantillas y billing", () => {
    const result = evaluateWhatsAppReadiness(readyInput());

    expect(result.status).toBe("ready");
    expect(result.gates.every((gate) => gate.status === "ready")).toBe(true);
    expect(result.nextAction).toBeNull();
  });

  it("conserva un bloqueo hasta que una acción manual autoriza la recuperación", () => {
    const blocked = evaluateWhatsAppReadiness(
      readyInput({
        connection: { ...readyInput().connection, status: "blocked" },
      }),
    );
    expect(blocked.status).toBe("blocked");
    expect(blocked.nextAction).toContain("Reactivar");

    const recovered = evaluateWhatsAppReadiness(
      readyInput({
        allowConnectionRecovery: true,
        connection: { ...readyInput().connection, status: "blocked" },
      }),
    );
    expect(recovered.status).toBe("ready");
  });

  it.each([
    ["PENDING", "Esperar aprobación de las plantillas críticas"],
    ["REJECTED", "Revisar el motivo de rechazo y sincronizar las plantillas"],
    ["DISABLED", "Revisar por qué se deshabilitó y sincronizar las plantillas"],
  ] as const)(
    "mantiene la Conexión fuera de ready con estado de plantilla %s",
    (status, nextAction) => {
      const templates = approvedTemplates({
        kind: "confirmation",
        rejectionReason: status === "REJECTED" ? "Contenido no aprobado" : null,
        status,
      });

      const result = evaluateWhatsAppReadiness(readyInput({ templates }));

      expect(result.status).not.toBe("ready");
      expect(
        result.gates.find((gate) => gate.code === "templates"),
      ).toMatchObject({
        status: status === "PENDING" ? "pending" : "blocked",
      });
      expect(result.nextAction).toBe(nextAction);
    },
  );

  it.each([
    ["missing", "Sincronizar las plantillas críticas", "pending"],
    ["submitted", "Esperar revisión de las plantillas críticas", "pending"],
    ["in_review", "Esperar aprobación de las plantillas críticas", "pending"],
    [
      "rejected",
      "Revisar el motivo de rechazo y sincronizar las plantillas",
      "blocked",
    ],
  ] as const)(
    "distingue el estado de provisionamiento %s de la plantilla",
    (provisioningStatus, nextAction, gateStatus) => {
      const templates = approvedTemplates({
        kind: "confirmation",
        provisioningStatus,
        rejectionReason:
          provisioningStatus === "rejected" ? "Contenido no aprobado" : null,
      });

      const result = evaluateWhatsAppReadiness(readyInput({ templates }));

      expect(
        result.gates.find((gate) => gate.code === "templates"),
      ).toMatchObject({
        status: gateStatus,
      });
      expect(result.nextAction).toBe(nextAction);
    },
  );

  it("bloquea una versión de catálogo obsoleta aunque la plantilla esté aprobada", () => {
    const templates = approvedTemplates({
      catalogVersion: 0,
      kind: "reminder",
    });

    const result = evaluateWhatsAppReadiness(readyInput({ templates }));

    expect(result.status).toBe("blocked");
    expect(result.nextAction).toBe(
      "Sincronizar la versión vigente de las plantillas críticas",
    );
  });

  it("bloquea una plantilla aprobada cuyo contenido remoto difiere del catálogo", () => {
    const templates = approvedTemplates({
      content: "Contenido obsoleto: {{patient_name}}",
      kind: "confirmation",
    });

    const result = evaluateWhatsAppReadiness(readyInput({ templates }));

    expect(result.status).toBe("blocked");
    expect(
      result.gates.find((gate) => gate.code === "templates"),
    ).toMatchObject({
      status: "blocked",
    });
    expect(result.nextAction).toContain("contenido");
  });

  it("bloquea un locale incorrecto o variables incompletas con una acción concreta", () => {
    const templates = approvedTemplates({
      kind: "reminder",
      locale: "en_US",
      variables: ["clinic_name"],
    });

    const result = evaluateWhatsAppReadiness(readyInput({ templates }));

    expect(result.status).toBe("blocked");
    const templatesGate = result.gates.find(
      (gate) => gate.code === "templates",
    );
    expect(templatesGate?.message).toContain("locale");
    expect(templatesGate?.status).toBe("blocked");
    expect(result.nextAction).toContain("locale");
  });

  it("bloquea una plantilla aprobada que no sea Utility", () => {
    const templates = approvedTemplates({
      category: "MARKETING",
      kind: "reminder",
    });

    const result = evaluateWhatsAppReadiness(readyInput({ templates }));

    expect(result.status).toBe("blocked");
    expect(result.nextAction).toContain("categoría Utility");
  });

  it.each([
    ["unknown", "pending"],
    ["degraded", "degraded"],
    ["unhealthy", "blocked"],
    ["error", "blocked"],
  ] as const)(
    "mantiene fuera de ready una salud de número %s",
    (health, status) => {
      const result = evaluateWhatsAppReadiness(
        readyInput({
          number: {
            environment: "production",
            health,
            healthCheckedAt: now,
          },
        }),
      );

      expect(result.status).toBe(status);
      expect(
        result.gates.find((gate) => gate.code === "number")?.status,
      ).not.toBe("ready");
    },
  );

  it("bloquea el envío cuando el crédito partner-managed es insuficiente", () => {
    const result = evaluateWhatsAppReadiness(
      readyInput({
        billing: {
          alertThresholdCents: 1_000,
          chargesSeparated: true,
          consumedCents: 10_000,
          creditCents: 0,
          mode: "partner_managed",
          status: "ready",
        },
      }),
    );

    expect(result.status).toBe("blocked");
    const billingGate = result.gates.find((gate) => gate.code === "billing");
    expect(billingGate?.message).toContain("crédito");
    expect(billingGate?.status).toBe("blocked");
    expect(result.nextAction).toBe("Agregar crédito antes de habilitar envíos");
  });

  it("no habilita envíos si falta el umbral de alerta de crédito", () => {
    const result = evaluateWhatsAppReadiness(
      readyInput({
        billing: {
          alertThresholdCents: null,
          chargesSeparated: true,
          consumedCents: 10_000,
          creditCents: 10_000,
          mode: "partner_managed",
          status: "ready",
        },
      }),
    );

    expect(result.status).toBe("blocked");
    expect(result.nextAction).toBe(
      "Configurar un umbral de alerta antes de habilitar envíos",
    );
  });

  it("conserva el preflight de webhook como diagnóstico opcional", () => {
    const result = evaluateWhatsAppReadiness(
      readyInput({
        e2e: {
          evidence: "Kapso webhook test success=true",
          evidenceScope: "webhook-preflight",
          lastTestAt: now,
          status: "passed",
        },
      }),
    );

    expect(result.status).toBe("ready");
    expect(result.nextAction).toBeNull();
    expect(result.gates.find((gate) => gate.code === "e2e")?.status).toBe(
      "pending",
    );
  });

  it("requiere revalidar la salud antes de permitir envíos", () => {
    const result = evaluateWhatsAppReadiness(
      readyInput({
        now: new Date(now.valueOf() + 16 * 60_000),
        number: {
          environment: "production",
          health: "healthy",
          healthCheckedAt: now,
        },
      }),
    );

    expect(result.status).toBe("pending");
    expect(result.nextAction).toBe("Revalidar la salud del número en Kapso");
  });
});
