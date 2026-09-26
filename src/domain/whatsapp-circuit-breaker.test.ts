import { describe, expect, it } from "vitest";

import {
  canReactivateWhatsAppCircuit,
  countWhatsAppQuotaMessages,
  evaluateWhatsAppCircuitReactivationEvidence,
  evaluateWhatsAppBillingHealth,
  reconcileWhatsAppQuotaConsumption,
  sanitizeWhatsAppOperationalText,
  shouldOpenWhatsAppCircuit,
  type WhatsAppCircuitBreakerState,
} from "./whatsapp-circuit-breaker";

const now = new Date("2026-09-12T12:00:00.000Z");

function closedState(
  overrides: Partial<WhatsAppCircuitBreakerState> = {},
): WhatsAppCircuitBreakerState {
  return {
    clinicId: "clinic-1",
    cause: null,
    failureCount: 0,
    failureWindowStartedAt: null,
    lastFailureAt: null,
    lastReactivatedAt: null,
    lastReactivatedByIdentityId: null,
    lastSyntheticEvidence: null,
    lastSyntheticTestAt: null,
    lastSyntheticTestStatus: null,
    openedBy: null,
    lastTransitionAt: now,
    nextAction: "La Conexión opera normalmente",
    openedAt: null,
    reason: "Circuito cerrado",
    revision: 0,
    status: "closed",
    updatedAt: now,
    ...overrides,
  };
}

describe("circuit breaker de WhatsApp", () => {
  it("abre solo después de fallos persistentes dentro de la ventana", () => {
    expect(
      shouldOpenWhatsAppCircuit({
        failureCount: 2,
        now,
        threshold: 3,
        windowStartedAt: new Date(now.valueOf() - 4 * 60_000),
        windowMs: 5 * 60_000,
      }),
    ).toBe(false);
    expect(
      shouldOpenWhatsAppCircuit({
        failureCount: 3,
        now,
        threshold: 3,
        windowStartedAt: new Date(now.valueOf() - 4 * 60_000),
        windowMs: 5 * 60_000,
      }),
    ).toBe(true);
    expect(
      shouldOpenWhatsAppCircuit({
        failureCount: 3,
        now,
        threshold: 3,
        windowStartedAt: new Date(now.valueOf() - 6 * 60_000),
        windowMs: 5 * 60_000,
      }),
    ).toBe(false);
  });

  it("separa cuota Kapso de cobros Meta y excluye los recibos de lectura", () => {
    expect(
      countWhatsAppQuotaMessages([
        { category: "message", direction: "inbound" },
        { category: "message", direction: "outbound" },
        { category: "media", direction: "outbound" },
        { category: "template", direction: "outbound" },
        { category: "interactive", direction: "outbound" },
        { category: "reaction", direction: "inbound" },
        { category: "read-receipt", direction: "outbound" },
      ]),
    ).toBe(6);
  });

  it("eleva a crítico el primer umbral entre saldo y autonomía", () => {
    expect(
      evaluateWhatsAppBillingHealth({
        creditCents: 1_500,
        creditLimitCents: 10_000,
        estimatedDailyConsumptionCents: 100,
      }),
    ).toMatchObject({ level: "warning", balancePercent: 15, autonomyDays: 15 });
    expect(
      evaluateWhatsAppBillingHealth({
        creditCents: 800,
        creditLimitCents: 10_000,
        estimatedDailyConsumptionCents: 100,
      }),
    ).toMatchObject({ level: "critical", balancePercent: 8, autonomyDays: 8 });
    expect(
      evaluateWhatsAppBillingHealth({
        creditCents: 1_000,
        creditLimitCents: 10_000,
        estimatedDailyConsumptionCents: 500,
      }),
    ).toMatchObject({ level: "critical", balancePercent: 10, autonomyDays: 2 });
  });

  it("reinicia el contador de cuota solo cuando cambia el período mensual", () => {
    expect(
      reconcileWhatsAppQuotaConsumption({
        incomingConsumed: 2,
        incomingPeriod: "2026-10",
        incomingSnapshotIsOlder: false,
        persistedConsumed: 99,
        persistedPeriod: "2026-09",
      }),
    ).toBe(2);
    expect(
      reconcileWhatsAppQuotaConsumption({
        incomingConsumed: 2,
        incomingPeriod: "2026-09",
        incomingSnapshotIsOlder: false,
        persistedConsumed: 99,
        persistedPeriod: "2026-09",
      }),
    ).toBe(99);
    expect(
      reconcileWhatsAppQuotaConsumption({
        incomingConsumed: 2,
        incomingPeriod: "2026-09",
        incomingSnapshotIsOlder: true,
        persistedConsumed: 99,
        persistedPeriod: "2026-09",
      }),
    ).toBe(99);
  });

  it("no persiste secretos en razones operativas, incluidos tokens Bearer", () => {
    const sanitized = sanitizeWhatsAppOperationalText(
      "Authorization: Bearer super-secret x-api-key=api-secret",
    );

    expect(sanitized).toBe("Authorization: [redacted] x-api-key=[redacted]");
    expect(sanitized).not.toContain("super-secret");
    expect(sanitized).not.toContain("api-secret");
  });

  it("redacta credenciales embebidas en URLs operativas", () => {
    const sanitized = sanitizeWhatsAppOperationalText(
      "Kapso callback https://user:super-secret@example.com/webhook",
    );

    expect(sanitized).toBe(
      "Kapso callback https://[redacted]@example.com/webhook",
    );
    expect(sanitized).not.toContain("super-secret");
  });

  it("redacta secretos en claves JSON de errores remotos", () => {
    const sanitized = sanitizeWhatsAppOperationalText(
      '{"access_token":"token-92","authorization":"Bearer auth-92","password":"password-92"}',
    );

    expect(sanitized).toBe(
      '{"access_token":"[redacted]","authorization":"[redacted]","password":"[redacted]"}',
    );
    expect(sanitized).not.toContain("token-92");
    expect(sanitized).not.toContain("auth-92");
    expect(sanitized).not.toContain("password-92");
  });

  it("exige causa corregida, prueba sintética aprobada y confirmación manual", () => {
    const state = closedState({ status: "open", cause: "provider-error" });
    expect(
      canReactivateWhatsAppCircuit({
        causeFixed: false,
        manualConfirmation: true,
        state,
        syntheticTestPassed: true,
      }),
    ).toBe(false);
    expect(
      canReactivateWhatsAppCircuit({
        causeFixed: true,
        manualConfirmation: false,
        state,
        syntheticTestPassed: true,
      }),
    ).toBe(false);
    expect(
      canReactivateWhatsAppCircuit({
        causeFixed: true,
        manualConfirmation: true,
        state,
        syntheticTestPassed: true,
      }),
    ).toBe(true);
  });

  it("rechaza un preflight que no conserva el roundtrip E2E del proveedor", () => {
    const result = evaluateWhatsAppCircuitReactivationEvidence({
      connectionGenerationId: "generation-1",
      connectionProvider: "kapso",
      now,
      smoke: {
        controlledTestContact: true,
        evidence: "Kapso confirmó el webhook",
        finishedAt: now,
        id: "smoke-1",
        provisioningEventId: "generation-1",
        providerTransportVerified: false,
        realPatientsEnabled: false,
        requireRealRoundtrip: true,
        startedAt: now,
        status: "passed",
        syntheticContact: false,
        steps: [],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/roundtrip/i);
  });

  it("solo acepta evidencia E2E reciente de la generación actual", () => {
    const roundtripSources = [
      ["real-reception", "provider"],
      ["real-processing", "application"],
      ["real-response", "provider"],
      ["real-delivery", "provider"],
    ] as const;
    const smoke = {
      controlledTestContact: true,
      evidence: "Roundtrip verificado",
      finishedAt: now,
      id: "smoke-1",
      provisioningEventId: "generation-1",
      providerTransportVerified: true,
      realPatientsEnabled: false,
      requireRealRoundtrip: true,
      startedAt: new Date(now.valueOf() - 30_000),
      status: "passed" as const,
      syntheticContact: false,
      steps: roundtripSources.map(([code, source]) => ({
        code,
        evidence: `evidence:${code}`,
        eventId: `event:${code}`,
        message: null,
        observedAt: now,
        passed: true,
        source,
        status: "passed" as const,
      })),
    };

    expect(
      evaluateWhatsAppCircuitReactivationEvidence({
        connectionGenerationId: "generation-1",
        connectionProvider: "kapso",
        now,
        smoke,
      }).valid,
    ).toBe(true);
    const differentGeneration = evaluateWhatsAppCircuitReactivationEvidence({
      connectionGenerationId: "generation-2",
      connectionProvider: "kapso",
      now,
      smoke,
    });
    expect(differentGeneration.valid).toBe(false);
    expect(differentGeneration.reason).toMatch(/generación/i);
    const expired = evaluateWhatsAppCircuitReactivationEvidence({
      connectionGenerationId: "generation-1",
      connectionProvider: "kapso",
      now,
      smoke: {
        ...smoke,
        finishedAt: new Date(now.valueOf() - 5 * 60_000 - 1),
      },
    });
    expect(expired.valid).toBe(false);
    expect(expired.reason).toMatch(/expiró/i);
  });
});
