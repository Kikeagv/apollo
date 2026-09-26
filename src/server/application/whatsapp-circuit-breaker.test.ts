import { describe, expect, it } from "vitest";

import {
  defaultWhatsAppCircuitBreakerState,
  type WhatsAppCircuitBreakerState,
  type WhatsAppCircuitReactivationSmoke,
} from "~/domain/whatsapp-circuit-breaker";

import {
  getWhatsAppCircuitBreaker,
  openWhatsAppCircuitBreaker,
  recordWhatsAppOperationalFailure,
  reactivateWhatsAppCircuitBreaker,
  type WhatsAppCircuitBreakerStore,
} from "./whatsapp-circuit-breaker";

const now = new Date("2026-09-12T12:00:00.000Z");

function validKapsoSmokeEvidence(
  overrides: Partial<WhatsAppCircuitReactivationSmoke> = {},
): WhatsAppCircuitReactivationSmoke {
  const roundtripCodes = [
    ["real-reception", "provider"],
    ["real-processing", "application"],
    ["real-response", "provider"],
    ["real-delivery", "provider"],
  ] as const;
  return {
    controlledTestContact: true,
    evidence: "Roundtrip de Kapso verificado",
    finishedAt: now,
    id: "smoke-run-1",
    provisioningEventId: "generation-1",
    providerTransportVerified: true,
    realPatientsEnabled: false,
    requireRealRoundtrip: true,
    startedAt: new Date(now.valueOf() - 30_000),
    status: "passed",
    syntheticContact: false,
    steps: roundtripCodes.map(([code, source]) => ({
      code,
      evidence: `evidence:${code}`,
      eventId: `event:${code}`,
      message: null,
      observedAt: now,
      passed: true,
      source,
      status: "passed" as const,
    })),
    ...overrides,
  };
}

function fakeStore() {
  const states = new Map<string, WhatsAppCircuitBreakerState>();
  const reads: string[] = [];
  const store: WhatsAppCircuitBreakerStore = {
    async read({ clinicId }) {
      reads.push(clinicId);
      return (
        states.get(clinicId) ??
        defaultWhatsAppCircuitBreakerState(clinicId, now)
      );
    },
    async open(input) {
      const state = {
        ...(states.get(input.clinicId) ??
          defaultWhatsAppCircuitBreakerState(input.clinicId, input.now)),
        cause: input.cause,
        lastTransitionAt: input.now,
        nextAction: "Corregir la causa y ejecutar una prueba sintética",
        openedAt: input.now,
        reason: input.reason,
        status: "open" as const,
        updatedAt: input.now,
      };
      states.set(input.clinicId, state);
      return state;
    },
    async recordFailure(input) {
      const current =
        states.get(input.clinicId) ??
        defaultWhatsAppCircuitBreakerState(input.clinicId, input.now);
      const failureCount = current.failureCount + 1;
      const next = {
        ...current,
        failureCount,
        lastFailureAt: input.now,
        ...(failureCount >= 3
          ? {
              cause: input.cause,
              lastTransitionAt: input.now,
              nextAction: "Corregir la causa y ejecutar una prueba sintética",
              openedAt: input.now,
              reason: input.reason,
              status: "open" as const,
            }
          : {}),
        updatedAt: input.now,
      };
      states.set(input.clinicId, next);
      return { opened: next.status === "open", state: next };
    },
    async recordSyntheticTest(input) {
      const current = states.get(input.clinicId)!;
      const next = {
        ...current,
        lastSyntheticEvidence: input.evidence,
        lastSyntheticTestAt: input.now,
        lastSyntheticTestStatus: input.passed
          ? ("passed" as const)
          : ("failed" as const),
        revision: current.revision + 1,
      };
      states.set(input.clinicId, next);
      return next;
    },
    async reactivate(input) {
      const current = states.get(input.clinicId)!;
      const next = {
        ...current,
        cause: null,
        failureCount: 0,
        failureWindowStartedAt: null,
        lastReactivatedAt: input.now,
        lastReactivatedByIdentityId: input.actorIdentityId,
        lastTransitionAt: input.now,
        nextAction: "La Conexión opera normalmente",
        openedAt: null,
        reason: "Circuito reactivado manualmente",
        revision: current.revision + 1,
        status: "closed" as const,
        updatedAt: input.now,
      };
      states.set(input.clinicId, next);
      return next;
    },
    async readMetrics() {
      return {
        averageLatencyMs: null,
        errors: 0,
        inboundMessages: 0,
        interactiveMessages: 0,
        mediaMessages: 0,
        metaChargesCents: 0,
        outboundMessages: 0,
        platformChargesCents: 0,
        quotaMessages: 0,
        readReceipts: 0,
        reactionMessages: 0,
        templateMessages: 0,
        totalLatencyMs: 0,
        deliveries: {
          accepted: 0,
          attempted: 0,
          delivered: 0,
          failed: 0,
          unknown: 0,
        },
        templates: [],
      };
    },
    async recordMetric() {
      return undefined;
    },
  };
  return { reads, states, store };
}

describe("operar el circuit breaker de WhatsApp", () => {
  it("mantiene el estado aislado por Clínica y abre ante fallos persistentes", async () => {
    const fake = fakeStore();

    await recordWhatsAppOperationalFailure(
      {
        cause: "provider-error",
        clinicId: "clinic-1",
        now,
        reason: "Kapso respondió 503",
      },
      fake.store,
    );
    await recordWhatsAppOperationalFailure(
      {
        cause: "provider-error",
        clinicId: "clinic-1",
        now: new Date(now.valueOf() + 1_000),
        reason: "Kapso respondió 503",
      },
      fake.store,
    );
    const opened = await recordWhatsAppOperationalFailure(
      {
        cause: "provider-error",
        clinicId: "clinic-1",
        now: new Date(now.valueOf() + 2_000),
        reason: "Kapso respondió 503",
      },
      fake.store,
    );

    expect(opened.opened).toBe(true);
    expect(
      (await getWhatsAppCircuitBreaker({ clinicId: "clinic-1" }, fake.store))
        .status,
    ).toBe("open");
    expect(
      (await getWhatsAppCircuitBreaker({ clinicId: "clinic-2" }, fake.store))
        .status,
    ).toBe("closed");
    expect(fake.reads).toEqual(["clinic-1", "clinic-2"]);
  });

  it("no reactiva sin confirmar la causa y exige el roundtrip antes de cerrar", async () => {
    const fake = fakeStore();
    await openWhatsAppCircuitBreaker(
      {
        actorIdentityId: "superadmin-1",
        cause: "credit-exhausted",
        clinicId: "clinic-1",
        now,
        reason: "Saldo Kapso agotado",
      },
      fake.store,
    );
    await expect(
      reactivateWhatsAppCircuitBreaker(
        {
          actorIdentityId: "superadmin-1",
          causeFixed: false,
          clinicId: "clinic-1",
          connectionProvider: "simulated",
          e2eEvidence: null,
          manualConfirmation: true,
          now,
          phoneNumberId: "phone-1",
          projectWebhookId: "webhook-1",
          connectionEvidence: {
            connectionUpdatedAt: now,
            provisioningEventId: null,
            readinessRevision: 0,
          },
        },
        { store: fake.store },
      ),
    ).rejects.toThrow("causa");

    const result = await reactivateWhatsAppCircuitBreaker(
      {
        actorIdentityId: "superadmin-1",
        causeFixed: true,
        clinicId: "clinic-1",
        connectionProvider: "simulated",
        e2eEvidence: {
          controlledTestContact: false,
          evidence: "Roundtrip sintético OK",
          finishedAt: now,
          id: "smoke-run-1",
          provisioningEventId: null,
          providerTransportVerified: false,
          realPatientsEnabled: false,
          requireRealRoundtrip: false,
          startedAt: now,
          status: "passed",
          syntheticContact: true,
          steps: [],
        },
        manualConfirmation: true,
        now,
        phoneNumberId: "phone-1",
        projectWebhookId: "webhook-1",
        connectionEvidence: {
          connectionUpdatedAt: now,
          provisioningEventId: null,
          readinessRevision: 0,
        },
      },
      { store: fake.store },
    );

    expect(result.status).toBe("closed");
    expect(result.lastSyntheticTestStatus).toBe("passed");
  });

  it("conserva el circuito abierto cuando la prueba aprobada no trae evidencia", async () => {
    const fake = fakeStore();
    await openWhatsAppCircuitBreaker(
      {
        actorIdentityId: "superadmin-1",
        cause: "provider-error",
        clinicId: "clinic-1",
        now,
        reason: "Kapso respondió 503",
      },
      fake.store,
    );

    await expect(
      reactivateWhatsAppCircuitBreaker(
        {
          actorIdentityId: "superadmin-1",
          causeFixed: true,
          clinicId: "clinic-1",
          connectionProvider: "kapso",
          e2eEvidence: validKapsoSmokeEvidence({ evidence: "   " }),
          manualConfirmation: true,
          now,
          phoneNumberId: "phone-1",
          projectWebhookId: "webhook-1",
          connectionEvidence: {
            connectionUpdatedAt: now,
            provisioningEventId: "generation-1",
            readinessRevision: 1,
          },
        },
        { store: fake.store },
      ),
    ).rejects.toThrow(/evidencia/i);

    expect(fake.states.get("clinic-1")?.status).toBe("open");
    expect(fake.states.get("clinic-1")?.lastSyntheticTestStatus).toBe("failed");
  });

  it("reactiva con un roundtrip persistido y no vuelve a ejecutar solo el preflight", async () => {
    const fake = fakeStore();
    await openWhatsAppCircuitBreaker(
      {
        actorIdentityId: "superadmin-1",
        cause: "provider-error",
        clinicId: "clinic-1",
        now,
        reason: "Kapso respondió 503",
      },
      fake.store,
    );
    const e2eEvidence = validKapsoSmokeEvidence();

    const result = await reactivateWhatsAppCircuitBreaker(
      {
        actorIdentityId: "superadmin-1",
        causeFixed: true,
        clinicId: "clinic-1",
        connectionEvidence: {
          connectionUpdatedAt: now,
          provisioningEventId: "generation-1",
          readinessRevision: 1,
        },
        connectionProvider: "kapso",
        e2eEvidence,
        manualConfirmation: true,
        now,
        phoneNumberId: "phone-1",
        projectWebhookId: "webhook-1",
      },
      { store: fake.store },
    );

    expect(result.status).toBe("closed");
    expect(result.lastSyntheticTestStatus).toBe("passed");
    expect(result.lastSyntheticEvidence).toContain("Roundtrip de Kapso");
  });
});
