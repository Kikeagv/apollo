import {
  canReactivateWhatsAppCircuit,
  defaultWhatsAppCircuitBreakerState,
  type WhatsAppCircuitBreakerCause,
  type WhatsAppCircuitBreakerState,
  type WhatsAppUsageMetric,
} from "~/domain/whatsapp-circuit-breaker";

export class WhatsAppOperationalMetricPersistenceError extends Error {
  readonly retryable = true;
  readonly ambiguous = false;

  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? `No se pudo persistir la métrica operativa: ${cause.message}`
        : "No se pudo persistir la métrica operativa",
    );
    this.name = "WhatsAppOperationalMetricPersistenceError";
  }
}

export type WhatsAppCircuitBreakerStore = {
  read(input: {
    access: "clinic-owner" | "superadmin" | "worker";
    actorIdentityId?: string;
    clinicId: string;
    workerKind?: "inbound" | "outbound" | "provisioning" | "delivery-status";
  }): Promise<WhatsAppCircuitBreakerState>;
  open(input: {
    actorIdentityId?: string | null;
    actorKind?: "superadmin" | "system" | "worker";
    cause: WhatsAppCircuitBreakerCause;
    clinicId: string;
    now: Date;
    reason: string;
    workerKind?: "inbound" | "outbound" | "provisioning" | "delivery-status";
  }): Promise<WhatsAppCircuitBreakerState>;
  recordFailure(input: {
    cause: WhatsAppCircuitBreakerCause;
    clinicId: string;
    now: Date;
    reason: string;
    workerKind?: "inbound" | "outbound" | "provisioning" | "delivery-status";
  }): Promise<{ opened: boolean; state: WhatsAppCircuitBreakerState }>;
  recordSyntheticTest(input: {
    actorIdentityId?: string | null;
    clinicId: string;
    evidence: string;
    now: Date;
    passed: boolean;
    expectedRevision?: number;
  }): Promise<WhatsAppCircuitBreakerState>;
  reactivate(input: {
    actorIdentityId: string;
    clinicId: string;
    now: Date;
    expectedRevision?: number;
    expectedConnection: {
      connectionUpdatedAt: Date;
      phoneNumberId: string;
      projectWebhookId: string;
      provisioningEventId: string | null;
      readinessRevision: number;
    };
    expectedSyntheticTestAt?: Date | null;
  }): Promise<WhatsAppCircuitBreakerState>;
  recordMetric(input: {
    clinicId: string;
    errorCode?: string | null;
    latencyMs?: number | null;
    metric: WhatsAppUsageMetric;
    occurredAt: Date;
    outcome: "accepted" | "delivered" | "failed" | "read" | "unknown";
    idempotencyKey: string;
    metaChargesCents?: number | null;
    operation: string;
    platformChargesCents?: number | null;
    templateName?: string | null;
    workerKind?: "inbound" | "outbound" | "provisioning" | "delivery-status";
  }): Promise<void>;
  readMetrics(input: {
    actorIdentityId: string;
    clinicId: string;
    from?: Date;
    to?: Date;
  }): Promise<WhatsAppOperationalMetrics>;
};

export type WhatsAppCircuitBreakerSyntheticTestProvider = {
  runSyntheticTest(input: {
    clinicId: string;
    phoneNumberId: string;
    projectWebhookId: string;
  }): Promise<{ evidence: string; passed: boolean }>;
};

export type WhatsAppOperationalMetrics = {
  averageLatencyMs: number | null;
  deliveries: {
    accepted: number;
    attempted: number;
    delivered: number;
    failed: number;
    unknown: number;
  };
  errors: number;
  inboundMessages: number;
  interactiveMessages: number;
  mediaMessages: number;
  metaChargesCents: number;
  outboundMessages: number;
  platformChargesCents: number;
  quotaMessages: number;
  readReceipts: number;
  reactionMessages: number;
  templateMessages: number;
  templates: Array<{
    attempted: number;
    failed: number;
    name: string;
  }>;
  totalLatencyMs: number;
};

export type WhatsAppOperationalObserver = Pick<
  WhatsAppCircuitBreakerStore,
  "recordFailure" | "recordMetric"
>;

export async function persistWhatsAppOperationalMetric(
  observer: WhatsAppOperationalObserver,
  input: Parameters<WhatsAppCircuitBreakerStore["recordMetric"]>[0],
) {
  try {
    await observer.recordMetric(input);
  } catch (error) {
    throw new WhatsAppOperationalMetricPersistenceError(error);
  }
}

export async function getWhatsAppCircuitBreaker(
  input: {
    actorIdentityId?: string;
    access?: "clinic-owner" | "superadmin" | "worker";
    clinicId: string;
  },
  store: WhatsAppCircuitBreakerStore,
) {
  return store.read({
    access: input.access ?? "superadmin",
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
  });
}

export async function openWhatsAppCircuitBreaker(
  input: {
    actorIdentityId?: string | null;
    actorKind?: "superadmin" | "system" | "worker";
    cause: WhatsAppCircuitBreakerCause;
    clinicId: string;
    now?: Date;
    reason: string;
  },
  store: WhatsAppCircuitBreakerStore,
) {
  return store.open({ ...input, now: input.now ?? new Date() });
}

export function recordWhatsAppOperationalFailure(
  input: {
    cause: WhatsAppCircuitBreakerCause;
    clinicId: string;
    now?: Date;
    reason: string;
  },
  store: WhatsAppCircuitBreakerStore,
) {
  return store.recordFailure({ ...input, now: input.now ?? new Date() });
}

export async function reactivateWhatsAppCircuitBreaker(
  input: {
    actorIdentityId: string;
    causeFixed: boolean;
    clinicId: string;
    manualConfirmation: boolean;
    now?: Date;
    phoneNumberId: string;
    projectWebhookId: string;
    connectionEvidence: {
      connectionUpdatedAt: Date;
      provisioningEventId: string | null;
      readinessRevision: number;
    };
  },
  dependencies: {
    provider: WhatsAppCircuitBreakerSyntheticTestProvider;
    store: WhatsAppCircuitBreakerStore;
  },
) {
  const now = input.now ?? new Date();
  const state = await dependencies.store.read({
    access: "superadmin",
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
  });
  if (state.status !== "open") {
    throw new Error("La Conexión no tiene un circuito abierto");
  }
  if (!input.causeFixed) {
    throw new Error("La causa del circuito todavía no está corregida");
  }
  if (!input.manualConfirmation) {
    throw new Error("La reactivación requiere confirmación manual");
  }

  let test: { evidence: string; passed: boolean };
  try {
    test = await dependencies.provider.runSyntheticTest({
      clinicId: input.clinicId,
      phoneNumberId: input.phoneNumberId,
      projectWebhookId: input.projectWebhookId,
    });
  } catch (error) {
    await dependencies.store.recordSyntheticTest({
      actorIdentityId: input.actorIdentityId,
      clinicId: input.clinicId,
      evidence:
        error instanceof Error ? error.message : "Prueba sintética fallida",
      now,
      passed: false,
      expectedRevision: state.revision,
    });
    throw error;
  }
  const testedState = await dependencies.store.recordSyntheticTest({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    evidence: test.evidence,
    now,
    passed: test.passed,
    expectedRevision: state.revision,
  });
  if (
    !canReactivateWhatsAppCircuit({
      causeFixed: input.causeFixed,
      manualConfirmation: input.manualConfirmation,
      state: testedState,
      syntheticTestPassed: test.passed,
    })
  ) {
    throw new Error("La prueba sintética no permite reactivar la Conexión");
  }
  return dependencies.store.reactivate({
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    now,
    expectedConnection: {
      connectionUpdatedAt: input.connectionEvidence.connectionUpdatedAt,
      phoneNumberId: input.phoneNumberId,
      projectWebhookId: input.projectWebhookId,
      provisioningEventId: input.connectionEvidence.provisioningEventId,
      readinessRevision: input.connectionEvidence.readinessRevision,
    },
    expectedRevision: testedState.revision,
    expectedSyntheticTestAt: testedState.lastSyntheticTestAt,
  });
}

export function getWhatsAppOperationalMetrics(
  input: { actorIdentityId: string; clinicId: string; from?: Date; to?: Date },
  store: WhatsAppCircuitBreakerStore,
) {
  const to = input.to ?? new Date();
  const from = input.from ?? new Date(to.valueOf() - 365 * 24 * 60 * 60_000);
  return store.readMetrics({ ...input, from, to });
}

export function emptyWhatsAppOperationalMetrics(): WhatsAppOperationalMetrics {
  return {
    averageLatencyMs: null,
    deliveries: {
      accepted: 0,
      attempted: 0,
      delivered: 0,
      failed: 0,
      unknown: 0,
    },
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
    templates: [],
    totalLatencyMs: 0,
  };
}

export function defaultCircuitStateForClinic(clinicId: string, now?: Date) {
  return defaultWhatsAppCircuitBreakerState(clinicId, now);
}
