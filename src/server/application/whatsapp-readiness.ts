import {
  evaluateWhatsAppReadiness,
  type WhatsAppReadinessGate,
  type WhatsAppBillingSnapshot,
  type WhatsAppCriticalTemplateKind,
  type WhatsAppE2ESnapshot,
  type WhatsAppE2EEvidenceScope,
  type WhatsAppNumberHealth,
  type WhatsAppReadinessResult,
  type WhatsAppTechnicalReadinessStatus,
  type WhatsAppTemplateSnapshot,
  type WhatsAppWebhookSnapshot,
} from "~/domain/whatsapp-readiness";
import type {
  WhatsAppSyntheticSmokeStepCode,
  WhatsAppSyntheticSmokeStepInput,
} from "~/domain/whatsapp-smoke";
import {
  evaluateWhatsAppBillingHealth,
  type WhatsAppBillingHealth,
} from "~/domain/whatsapp-circuit-breaker";
import {
  type WhatsAppConnectionAlert,
  type WhatsAppConnectionAlertGate,
} from "~/domain/whatsapp-connection-alert";
import type { WhatsAppConnection } from "~/domain/whatsapp-connection";
import type { WhatsAppCircuitBreakerStore } from "./whatsapp-circuit-breaker";

export type WhatsAppReadinessAction =
  "templates" | "billing" | "e2e" | "webhooks" | "reactivate";

export type WhatsAppReadinessRemoteStep = {
  lastAttemptAt: Date | null;
  lastError: string | null;
  remoteId: string | null;
  status: WhatsAppWebhookSnapshot["status"];
};

export type WhatsAppReadinessTemplatesSync = {
  lastError: string | null;
  lastSyncedAt: Date | null;
  status: "ready" | "pending" | "failed";
};

export type WhatsAppReadinessBilling = WhatsAppBillingSnapshot & {
  lastError: string | null;
  lastSyncedAt: Date | null;
};

export type WhatsAppReadinessE2E = WhatsAppE2ESnapshot & {
  lastError: string | null;
};

export type WhatsAppReadinessRecord = {
  alerts?: WhatsAppConnectionAlert[];
  billing: WhatsAppReadinessBilling;
  clinicId: string;
  connection: WhatsAppConnection | null;
  e2e: WhatsAppReadinessE2E;
  nextAction: string | null;
  numberEnvironment: "production" | "sandbox" | "unknown";
  numberHealth: WhatsAppNumberHealth;
  numberHealthCheckedAt: Date | null;
  phoneNumberWebhook: WhatsAppReadinessRemoteStep;
  projectId: string | null;
  projectWebhook: WhatsAppReadinessRemoteStep;
  provisioningEventId: string | null;
  revision?: number;
  statusReason: string;
  templates: WhatsAppTemplateSnapshot[];
  templatesSync: WhatsAppReadinessTemplatesSync;
  technicalStatus: WhatsAppTechnicalReadinessStatus;
};

export type WhatsAppReadinessSnapshot = WhatsAppReadinessRecord & {
  billingHealth: WhatsAppBillingHealth;
  readiness: WhatsAppReadinessResult;
};

export type WhatsAppReadinessAccess = {
  access: "clinic-owner" | "superadmin";
  actorIdentityId: string;
  clinicId: string;
};

export type WhatsAppReadinessAlertSyncInput = {
  clinicId: string;
  gates: WhatsAppConnectionAlertGate[];
  now: Date;
  provisioningEventId: string;
} & (
  | { access: "superadmin"; actorIdentityId: string }
  | { access: "provisioning-worker"; leaseToken: string }
);

export type WhatsAppReadinessProvisioningStore = {
  openAlert(input: {
    access: "provisioning-worker";
    clinicId: string;
    eventId: string;
    gateCode: WhatsAppConnectionAlertGate["code"];
    leaseToken: string;
    nextAction: string;
    now: Date;
    reason: string;
  }): Promise<void>;
  readForProvisioning(input: {
    clinicId: string;
    eventId: string;
    leaseToken: string;
    phoneNumberId: string;
    projectId: string;
  }): Promise<WhatsAppReadinessRecord>;
  saveForProvisioning(input: {
    clinicId: string;
    eventId: string;
    leaseToken: string;
    phoneNumberId: string;
    projectId: string;
    state: WhatsAppReadinessRecord;
  }): Promise<WhatsAppReadinessRecord>;
  syncAlerts(input: WhatsAppReadinessAlertSyncInput): Promise<void>;
};

export type WhatsAppReadinessStore = {
  read(input: WhatsAppReadinessAccess): Promise<WhatsAppReadinessRecord>;
  save(input: {
    access: "superadmin";
    actorIdentityId: string;
    clinicId: string;
    expectedRevision: number;
    expectedConnectionUpdatedAt: Date | null;
    state: WhatsAppReadinessRecord;
  }): Promise<WhatsAppReadinessRecord>;
  readForProvisioning?: WhatsAppReadinessProvisioningStore["readForProvisioning"];
  saveForProvisioning?: WhatsAppReadinessProvisioningStore["saveForProvisioning"];
  openAlert?: WhatsAppReadinessProvisioningStore["openAlert"];
  syncAlerts?: WhatsAppReadinessProvisioningStore["syncAlerts"];
  retryWebhooks?: (input: {
    actorIdentityId: string;
    clinicId: string;
    eventId: string;
    now: Date;
  }) => Promise<void>;
};

export type WhatsAppReadinessProvider = {
  getBilling(input: {
    businessAccountId: string;
    phoneNumberId: string;
  }): Promise<WhatsAppBillingProviderResult>;
  runE2ETest(input: {
    phoneNumberId: string;
    projectWebhookId: string;
  }): Promise<{
    evidence: string;
    evidenceScope: WhatsAppE2EEvidenceScope;
    testedAt: Date;
  }>;
  runSyntheticSmoke?(input: {
    phoneNumberId: string;
    projectWebhookId: string;
    syntheticContactId: string;
  }): Promise<{
    evidence?: string;
    providerTransportVerified?: boolean;
    realPatientsEnabled: boolean;
    steps: Partial<
      Record<WhatsAppSyntheticSmokeStepCode, WhatsAppSyntheticSmokeStepInput>
    >;
    syntheticContact: boolean;
  }>;
  getNumberHealth(input: {
    phoneNumberId: string;
  }): Promise<{ checkedAt: Date; health: WhatsAppNumberHealth }>;
  syncTemplates(input: {
    businessAccountId: string;
    phoneNumberId: string;
  }): Promise<WhatsAppTemplateSyncResult>;
};

export type WhatsAppTemplateSyncResult = {
  numberEnvironment: "production" | "sandbox" | "unknown";
  numberHealth: WhatsAppNumberHealth;
  numberHealthCheckedAt: Date | null;
  syncedAt: Date;
  templates: WhatsAppTemplateSnapshot[];
};

export type WhatsAppBillingProviderResult = Omit<
  WhatsAppBillingSnapshot,
  "status"
> & {
  status: "ready" | "pending";
  syncedAt?: Date;
};

export class WhatsAppReadinessBlockedError extends Error {
  readonly statePatch: Partial<WhatsAppReadinessRecord> | undefined;

  constructor(message: string, statePatch?: Partial<WhatsAppReadinessRecord>) {
    super(message);
    this.name = "WhatsAppReadinessBlockedError";
    this.statePatch = statePatch;
  }
}

export class WhatsAppReadinessConflictError extends Error {
  constructor() {
    super(
      "El readiness cambió mientras se ejecutaba la operación; vuelva a intentarlo",
    );
    this.name = "WhatsAppReadinessConflictError";
  }
}

export class WhatsAppReadinessRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppReadinessRetryError";
  }
}

/** Lee el estado técnico y recalcula la decisión desde sus evidencias. */
export async function getWhatsAppReadiness(
  input: WhatsAppReadinessAccess,
  store: WhatsAppReadinessStore,
): Promise<WhatsAppReadinessSnapshot> {
  const state = await store.read(input);
  const now = new Date();
  return toSnapshot(withDerivedState(state, now), now);
}

/** Reintenta un único gate; las demás integraciones no se ejecutan. */
export async function retryWhatsAppReadiness(
  input: {
    action: WhatsAppReadinessAction;
    actorIdentityId: string;
    clinicId: string;
  },
  dependencies: {
    now?: Date;
    provider: WhatsAppReadinessProvider;
    store: WhatsAppReadinessStore;
    circuitBreaker?: WhatsAppCircuitBreakerStore;
  },
): Promise<WhatsAppReadinessSnapshot> {
  const access: WhatsAppReadinessAccess = {
    access: "superadmin",
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
  };
  const state = await dependencies.store.read(access);
  const now = dependencies.now ?? new Date();

  if (input.action === "webhooks") {
    if (
      dependencies.store.retryWebhooks === undefined ||
      state.provisioningEventId === null
    ) {
      throw new WhatsAppReadinessBlockedError(
        "La Conexión no tiene una generación de webhooks reintentable",
      );
    }
    await dependencies.store.retryWebhooks({
      actorIdentityId: input.actorIdentityId,
      clinicId: input.clinicId,
      eventId: state.provisioningEventId,
      now,
    });
    return getWhatsAppReadiness(access, dependencies.store);
  }

  const expectedConnectionUpdatedAt = state.connection?.updatedAt ?? null;
  let next = cloneState(state);

  try {
    assertConnectionForAction(next.connection, input.action);
    next = await applyAction(next, input.action, dependencies.provider, now);
  } catch (error) {
    if (
      error instanceof WhatsAppReadinessBlockedError &&
      error.statePatch !== undefined
    ) {
      next = { ...next, ...error.statePatch };
    }
    if (!(error instanceof WhatsAppReadinessBlockedError)) {
      next = markActionFailed(next, input.action, error, now);
    }
    next = withDerivedState(next, now, false, true);
    if (next.connection !== null) {
      await dependencies.store.save({
        access: "superadmin",
        actorIdentityId: input.actorIdentityId,
        clinicId: input.clinicId,
        expectedRevision: state.revision ?? 0,
        expectedConnectionUpdatedAt,
        state: next,
      });
      await syncReadinessAlerts(dependencies.store, next, now, {
        access: "superadmin",
        actorIdentityId: input.actorIdentityId,
      });
      if (
        dependencies.circuitBreaker !== undefined &&
        !(error instanceof WhatsAppReadinessBlockedError)
      ) {
        await dependencies.circuitBreaker.recordFailure({
          cause: "provider-error",
          clinicId: input.clinicId,
          now,
          reason: toErrorMessage(error),
        });
      }
    }
    throw error;
  }

  next = withDerivedState(next, now, input.action === "reactivate", true);
  next = await dependencies.store.save({
    access: "superadmin",
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    expectedRevision: state.revision ?? 0,
    expectedConnectionUpdatedAt,
    state: next,
  });
  await syncReadinessAlerts(dependencies.store, next, now, {
    access: "superadmin",
    actorIdentityId: input.actorIdentityId,
  });
  await openCreditCircuitIfExhausted({
    action: input.action,
    actorIdentityId: input.actorIdentityId,
    circuitBreaker: dependencies.circuitBreaker,
    clinicId: input.clinicId,
    now,
    state: next,
  });
  if (
    input.action === "billing" &&
    dependencies.circuitBreaker !== undefined &&
    isCreditExhausted(next.billing)
  ) {
    return getWhatsAppReadiness(access, dependencies.store);
  }
  return toSnapshot(next, now);
}

/** Completa los gates automáticamente desde el worker de provisioning. */
export async function provisionWhatsAppReadiness(
  input: {
    clinicId: string;
    eventId: string;
    leaseToken: string;
    now: Date;
    phoneNumberId: string;
    projectId: string;
  },
  dependencies: {
    provider: WhatsAppReadinessProvider;
    store: WhatsAppReadinessProvisioningStore;
    circuitBreaker?: WhatsAppCircuitBreakerStore;
  },
): Promise<WhatsAppReadinessSnapshot> {
  const state = await dependencies.store.readForProvisioning(input);
  if (
    state.connection === null ||
    state.provisioningEventId !== input.eventId ||
    state.projectId !== input.projectId ||
    state.connection.phoneNumberId !== input.phoneNumberId
  ) {
    throw new WhatsAppReadinessConflictError();
  }

  const now = input.now;
  let next = withDerivedState(cloneState(state), now, true, true);
  let retryableFailure: string | null = null;
  next = await saveProvisioningReadiness(next, input, dependencies.store);

  for (const action of ["templates", "billing", "e2e"] as const) {
    try {
      assertConnectionForAction(next.connection, action);
      next = await applyAction(next, action, dependencies.provider, now);
    } catch (error) {
      if (
        error instanceof WhatsAppReadinessBlockedError &&
        error.statePatch !== undefined
      ) {
        next = { ...next, ...error.statePatch };
      } else {
        next = markActionFailed(next, action, error, now);
        if (retryableFailure === null && isRetryableReadinessError(error)) {
          retryableFailure = toErrorMessage(error);
        }
      }
    }
    next = withDerivedState(next, now, true, true);
    next = await saveProvisioningReadiness(next, input, dependencies.store);
    await openCreditCircuitIfExhausted({
      action,
      circuitBreaker: dependencies.circuitBreaker,
      clinicId: input.clinicId,
      now,
      state: next,
      workerKind: "provisioning",
    });
  }

  if (retryableFailure !== null && next.technicalStatus !== "blocked") {
    throw new WhatsAppReadinessRetryError(retryableFailure);
  }

  return toSnapshot(next, now);
}

async function saveProvisioningReadiness(
  state: WhatsAppReadinessRecord,
  input: {
    clinicId: string;
    eventId: string;
    leaseToken: string;
    now: Date;
    phoneNumberId: string;
    projectId: string;
  },
  store: WhatsAppReadinessProvisioningStore,
) {
  const persisted = await store.saveForProvisioning({
    clinicId: input.clinicId,
    eventId: input.eventId,
    leaseToken: input.leaseToken,
    phoneNumberId: input.phoneNumberId,
    projectId: input.projectId,
    state,
  });
  await syncReadinessAlerts(store, persisted, input.now, {
    access: "provisioning-worker",
    leaseToken: input.leaseToken,
  });
  return persisted;
}

async function syncReadinessAlerts(
  store: Pick<WhatsAppReadinessStore, "syncAlerts"> &
    Partial<WhatsAppReadinessProvisioningStore>,
  state: WhatsAppReadinessRecord,
  now: Date,
  access:
    | { access: "superadmin"; actorIdentityId: string }
    | { access: "provisioning-worker"; leaseToken: string },
) {
  if (store.syncAlerts === undefined || state.provisioningEventId === null) {
    return;
  }
  await store.syncAlerts({
    ...access,
    clinicId: state.clinicId,
    gates: evaluateWhatsAppReadiness(
      toEvaluationInput(state, false, now),
    ).gates.map((gate) => toAlertGate(gate, state)),
    now,
    provisioningEventId: state.provisioningEventId,
  });
}

function toAlertGate(
  gate: WhatsAppReadinessGate,
  state: WhatsAppReadinessRecord,
): WhatsAppConnectionAlertGate {
  const detail = readinessGateLastError(state, gate.code);
  return {
    action: gate.action,
    code: gate.code,
    message:
      detail !== null && !gate.message.includes(detail)
        ? `${gate.message}: ${detail}`
        : gate.message,
    status: gate.status,
  };
}

function readinessGateLastError(
  state: WhatsAppReadinessRecord,
  code: WhatsAppReadinessGate["code"],
) {
  if (code === "templates") return state.templatesSync.lastError;
  if (code === "billing") return state.billing.lastError;
  if (code === "e2e") return state.e2e.lastError;
  if (code === "webhooks") {
    return state.projectWebhook.lastError ?? state.phoneNumberWebhook.lastError;
  }
  return null;
}

function assertConnectionForAction(
  connection: WhatsAppConnection | null,
  action: WhatsAppReadinessAction,
) {
  if (connection?.provider !== "kapso") {
    throw new WhatsAppReadinessBlockedError(
      "La Clínica no tiene una Conexión Kapso provisionada",
    );
  }
  if (connection.phoneNumberId == null) {
    throw new WhatsAppReadinessBlockedError(
      "Kapso todavía no confirmó el phone_number_id de la Clínica",
    );
  }
  if (action !== "e2e" && connection.businessAccountId == null) {
    throw new WhatsAppReadinessBlockedError(
      "Kapso todavía no confirmó el Business Account de la Clínica",
    );
  }
}

async function openCreditCircuitIfExhausted(input: {
  action: WhatsAppReadinessAction;
  actorIdentityId?: string;
  circuitBreaker?: WhatsAppCircuitBreakerStore;
  clinicId: string;
  now: Date;
  state: WhatsAppReadinessRecord;
  workerKind?: "provisioning";
}) {
  if (input.action !== "billing" || input.circuitBreaker === undefined) return;
  const cause = isCreditExhausted(input.state.billing)
    ? "credit-exhausted"
    : isQuotaExhausted(input.state.billing)
      ? "quota-exhausted"
      : null;
  if (cause === null) return;
  await input.circuitBreaker.open({
    actorIdentityId: input.actorIdentityId ?? null,
    actorKind: input.workerKind === undefined ? "superadmin" : "worker",
    cause,
    clinicId: input.clinicId,
    now: input.now,
    reason: "La reserva de crédito de Kapso está agotada",
    workerKind: input.workerKind,
  });
}

function isCreditExhausted(billing: WhatsAppReadinessBilling) {
  return (
    billing.status === "ready" &&
    billing.creditCents <= (billing.creditReserveCents ?? 0)
  );
}

function isQuotaExhausted(billing: WhatsAppReadinessBilling) {
  return (
    billing.kapsoMonthlyQuota !== null &&
    (billing.kapsoQuotaConsumed ?? 0) +
      (billing.kapsoQuotaReserved ?? 0) +
      (billing.kapsoQuotaInFlight ?? 0) >=
      (billing.kapsoMonthlyQuota ?? 0)
  );
}

async function applyAction(
  state: WhatsAppReadinessRecord,
  action: WhatsAppReadinessAction,
  provider: WhatsAppReadinessProvider,
  now: Date,
): Promise<WhatsAppReadinessRecord> {
  const connection = state.connection;
  if (connection?.phoneNumberId == null) {
    throw new WhatsAppReadinessBlockedError(
      "No existe un número provisionado para ejecutar este gate",
    );
  }

  if (action === "reactivate") {
    const result = await provider.getNumberHealth({
      phoneNumberId: connection.phoneNumberId,
    });
    return {
      ...state,
      numberHealth: result.health,
      numberHealthCheckedAt: result.checkedAt,
    };
  }

  if (action === "templates") {
    const result = await provider.syncTemplates({
      businessAccountId: requireBusinessAccountId(connection),
      phoneNumberId: connection.phoneNumberId,
    });
    if (result.numberEnvironment === "sandbox") {
      throw new WhatsAppReadinessBlockedError(
        "Kapso deshabilita la sincronización de plantillas para números sandbox",
        {
          numberHealth: result.numberHealth,
          numberHealthCheckedAt: result.numberHealthCheckedAt,
          numberEnvironment: "sandbox",
          templatesSync: {
            lastError:
              "Kapso deshabilita la sincronización de plantillas para números sandbox",
            lastSyncedAt: state.templatesSync.lastSyncedAt,
            status: "failed",
          },
          templates: [],
        },
      );
    }
    if (result.numberEnvironment === "unknown") {
      return {
        ...state,
        numberHealth: result.numberHealth,
        numberHealthCheckedAt: result.numberHealthCheckedAt,
        numberEnvironment: "unknown",
        templatesSync: {
          lastError: null,
          lastSyncedAt: state.templatesSync.lastSyncedAt,
          status: "pending",
        },
      };
    }
    if (result.numberHealth !== "healthy") {
      return {
        ...state,
        numberEnvironment: result.numberEnvironment,
        numberHealth: result.numberHealth,
        numberHealthCheckedAt: result.numberHealthCheckedAt,
        templates: [],
        templatesSync: {
          lastError:
            result.numberHealth === "unknown"
              ? null
              : `Kapso reportó salud ${result.numberHealth} en el número de WhatsApp`,
          lastSyncedAt: state.templatesSync.lastSyncedAt,
          status: result.numberHealth === "unknown" ? "pending" : "failed",
        },
      };
    }
    return {
      ...state,
      numberHealth: result.numberHealth,
      numberHealthCheckedAt: result.numberHealthCheckedAt,
      numberEnvironment: result.numberEnvironment,
      templates: result.templates,
      templatesSync: {
        lastError: null,
        lastSyncedAt: result.syncedAt,
        status: "ready",
      },
    };
  }

  if (action === "billing") {
    const result = await provider.getBilling({
      businessAccountId: requireBusinessAccountId(connection),
      phoneNumberId: connection.phoneNumberId,
    });
    return {
      ...state,
      billing: {
        ...result,
        lastError: null,
        lastSyncedAt: result.syncedAt ?? now,
        status: result.status,
      },
    };
  }

  if (action === "webhooks") {
    throw new WhatsAppReadinessBlockedError(
      "Los webhooks se reintentan mediante la cola de provisioning",
    );
  }

  if (state.projectWebhook.remoteId === null) {
    throw new WhatsAppReadinessBlockedError(
      "El webhook de proyecto no tiene evidencia para ejecutar la prueba E2E",
    );
  }
  const result = await provider.runE2ETest({
    phoneNumberId: connection.phoneNumberId,
    projectWebhookId: state.projectWebhook.remoteId,
  });
  return {
    ...state,
    e2e: {
      evidence: result.evidence,
      evidenceScope: result.evidenceScope,
      lastError: null,
      lastTestAt: result.testedAt,
      status: "passed",
    },
  };
}

function isRetryableReadinessError(error: unknown) {
  if (error instanceof WhatsAppReadinessBlockedError) return false;
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : undefined;
  if (status !== undefined) {
    return status === 0 || status === 408 || status === 429 || status >= 500;
  }
  if (error instanceof Error) {
    return (
      error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      error.message.toLowerCase().includes("timeout")
    );
  }
  return true;
}

function markActionFailed(
  state: WhatsAppReadinessRecord,
  action: WhatsAppReadinessAction,
  error: unknown,
  now: Date,
): WhatsAppReadinessRecord {
  const message = toErrorMessage(error);
  if (action === "templates") {
    return {
      ...state,
      templatesSync: {
        lastError: message,
        lastSyncedAt: state.templatesSync.lastSyncedAt,
        status: "failed",
      },
    };
  }
  if (action === "billing") {
    return {
      ...state,
      billing: {
        ...state.billing,
        lastError: message,
        lastSyncedAt: state.billing.lastSyncedAt,
        status: "failed",
      },
    };
  }
  if (action === "reactivate") {
    return {
      ...state,
      numberHealth: "unknown",
      numberHealthCheckedAt: null,
    };
  }
  return {
    ...state,
    e2e: {
      ...state.e2e,
      lastError: message,
      lastTestAt: state.e2e.lastTestAt,
      status: "failed",
    },
    projectWebhook: {
      ...state.projectWebhook,
      lastAttemptAt: now,
    },
  };
}

function withDerivedState(
  state: WhatsAppReadinessRecord,
  now: Date,
  allowConnectionRecovery = false,
  touchConnection = false,
): WhatsAppReadinessRecord {
  const readiness = evaluateWhatsAppReadiness(
    toEvaluationInput(state, allowConnectionRecovery, now),
  );
  const templatesGate = readiness.gates.find(
    (gate) => gate.code === "templates",
  );
  const billingGate = readiness.gates.find((gate) => gate.code === "billing");
  const webhookGate = readiness.gates.find((gate) => gate.code === "webhooks");
  const connection =
    state.connection === null
      ? null
      : {
          ...state.connection,
          lastTestAt: state.e2e.lastTestAt,
          metadata: {
            ...state.connection.metadata,
            billingStatus: billingGate?.status ?? null,
            health: state.numberHealth,
            nextAction: readiness.nextAction,
            statusReason: readiness.statusReason,
            templatesStatus: templatesGate?.status ?? null,
            webhookStatus: webhookGate?.status ?? null,
          },
          status: connectionStatusForReadiness(
            state.connection.status,
            readiness.status,
          ),
          updatedAt: touchConnection ? now : state.connection.updatedAt,
        };

  return {
    ...state,
    connection,
    nextAction: readiness.nextAction,
    statusReason: readiness.statusReason,
    technicalStatus: readiness.status,
  };
}

function connectionStatusForReadiness(
  current: WhatsAppConnection["status"],
  readiness: WhatsAppTechnicalReadinessStatus,
): WhatsAppConnection["status"] {
  if (current === "disconnected") return "disconnected";
  if (readiness === "ready") return "ready";
  if (current === "blocked") return "blocked";
  if (current === "degraded") return "degraded";
  if (readiness === "blocked") return "blocked";
  if (readiness === "degraded") return "degraded";
  return current === "ready"
    ? "degraded"
    : current === "pending"
      ? "pending"
      : "provisioning";
}

function toEvaluationInput(
  state: WhatsAppReadinessRecord,
  allowConnectionRecovery = false,
  now?: Date,
) {
  const connection = state.connection;
  return {
    billing: state.billing,
    allowConnectionRecovery,
    connection: {
      businessAccountId: connection?.businessAccountId ?? null,
      connectionType: connection?.connectionType ?? "simulated",
      phoneNumberId: connection?.phoneNumberId ?? null,
      provider: connection?.provider ?? "simulated",
      status: connection?.status ?? "pending",
    },
    e2e: state.e2e,
    number: {
      environment: state.numberEnvironment,
      health: state.numberHealth,
      healthCheckedAt: state.numberHealthCheckedAt,
    },
    now,
    templates: state.templates,
    templatesSync: state.templatesSync,
    webhooks: {
      phoneNumber: state.phoneNumberWebhook,
      project: state.projectWebhook,
    },
  };
}

function toSnapshot(
  state: WhatsAppReadinessRecord,
  now = new Date(),
): WhatsAppReadinessSnapshot {
  return {
    ...state,
    billingHealth: evaluateWhatsAppBillingHealth({
      creditCents: state.billing.creditCents,
      creditLimitCents: state.billing.creditLimitCents ?? null,
      criticalAutonomyDays: state.billing.criticalAutonomyDays,
      criticalBalancePercent: state.billing.criticalBalancePercent,
      estimatedDailyConsumptionCents:
        state.billing.estimatedDailyConsumptionCents ?? 0,
      warningAutonomyDays: state.billing.warningAutonomyDays,
      warningBalancePercent: state.billing.warningBalancePercent,
    }),
    readiness: evaluateWhatsAppReadiness(toEvaluationInput(state, false, now)),
  };
}

function cloneState(state: WhatsAppReadinessRecord): WhatsAppReadinessRecord {
  return {
    ...state,
    alerts: state.alerts?.map((alert) => ({ ...alert })) ?? [],
    billing: { ...state.billing },
    connection:
      state.connection === null
        ? null
        : {
            ...state.connection,
            metadata: { ...state.connection.metadata },
          },
    e2e: { ...state.e2e },
    phoneNumberWebhook: { ...state.phoneNumberWebhook },
    projectWebhook: { ...state.projectWebhook },
    templates: state.templates.map((template) => ({
      ...template,
      variables: [...template.variables],
    })),
    templatesSync: { ...state.templatesSync },
  };
}

function requireBusinessAccountId(connection: WhatsAppConnection) {
  if (connection.businessAccountId == null) {
    throw new WhatsAppReadinessBlockedError(
      "Kapso todavía no confirmó el Business Account de la Clínica",
    );
  }
  return connection.businessAccountId;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Error desconocido de Kapso";
}

export type WhatsAppReadinessTemplateKind = WhatsAppCriticalTemplateKind;
