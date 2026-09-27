import {
  currentWhatsAppNumberHealth,
  evaluateWhatsAppReadiness,
  getWhatsAppReadinessGeneration,
  isWhatsAppNumberMessagingAvailable,
  isSameWhatsAppReadinessGeneration,
  whatsappNumberHealthMaxAgeMs,
  type WhatsAppReadinessGate,
  type WhatsAppBillingSnapshot,
  type WhatsAppCriticalTemplateKind,
  type WhatsAppE2ESnapshot,
  type WhatsAppE2EEvidenceScope,
  type WhatsAppReadinessGeneration,
  type WhatsAppNumberHealth,
  type WhatsAppReadinessResult,
  type WhatsAppTechnicalReadinessStatus,
  type WhatsAppTemplateSnapshot,
  type WhatsAppWebhookSnapshot,
} from "~/domain/whatsapp-readiness";
import {
  nextWhatsAppReadinessHealthCheckAt,
  nextWhatsAppReadinessPendingAt,
  nextWhatsAppReadinessReconciliationAttemptAt,
  type WhatsAppReadinessReconciliation,
  type WhatsAppReadinessReconciliationStatus,
  whatsappReadinessReconciliationMaxAttempts,
} from "~/domain/whatsapp-readiness-reconciliation";
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
  reconciliation: WhatsAppReadinessReconciliation;
  revision?: number;
  statusReason: string;
  templates: WhatsAppTemplateSnapshot[];
  templatesSync: WhatsAppReadinessTemplatesSync;
  technicalStatus: WhatsAppTechnicalReadinessStatus;
};

export type { WhatsAppReadinessReconciliation } from "~/domain/whatsapp-readiness-reconciliation";

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
  | { access: "reconciliation-worker"; leaseToken: string }
);

export type WhatsAppTemplateProvisioningLock = {
  withTemplateProvisioningLock?: <T>(input: {
    businessAccountId: string;
    operation: () => Promise<T>;
  }) => Promise<T>;
};

export type WhatsAppReadinessProvisioningStore =
  WhatsAppTemplateProvisioningLock & {
    openAlert(input: {
      access: "provisioning-worker" | "reconciliation-worker";
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
      now: Date;
      phoneNumberId: string;
      projectId: string;
    }): Promise<WhatsAppReadinessRecord>;
    saveForProvisioning(input: {
      clinicId: string;
      eventId: string;
      leaseToken: string;
      now: Date;
      phoneNumberId: string;
      projectId: string;
      state: WhatsAppReadinessRecord;
    }): Promise<WhatsAppReadinessRecord>;
    syncAlerts(input: WhatsAppReadinessAlertSyncInput): Promise<void>;
  };

export type WhatsAppReadinessReconciliationLease = {
  attempts: number;
  claimedGeneration: WhatsAppReadinessGeneration;
  clinicId: string;
  expectedGeneration: WhatsAppReadinessGeneration;
  leaseToken: string;
};

export type WhatsAppReadinessReconciliationStore =
  WhatsAppTemplateProvisioningLock &
    Pick<WhatsAppReadinessProvisioningStore, "syncAlerts"> & {
      claimDueReconciliations(input: {
        limit: number;
        now: Date;
      }): Promise<WhatsAppReadinessReconciliationLease[]>;
      completeReconciliation(input: {
        attempts?: number;
        clinicId: string;
        lastError: string | null;
        leaseToken: string;
        nextAttemptAt: Date | null;
        now: Date;
        status: WhatsAppReadinessReconciliationStatus;
      }): Promise<void>;
      readForReconciliation(input: {
        clinicId: string;
        leaseToken: string;
        now: Date;
      }): Promise<WhatsAppReadinessRecord>;
      saveForReconciliation(input: {
        clinicId: string;
        claimedGeneration: WhatsAppReadinessGeneration;
        expectedGeneration: WhatsAppReadinessGeneration;
        leaseToken: string;
        now: Date;
        state: WhatsAppReadinessRecord;
      }): Promise<WhatsAppReadinessRecord>;
    };

export type WhatsAppReadinessStore = WhatsAppTemplateProvisioningLock & {
  read(input: WhatsAppReadinessAccess): Promise<WhatsAppReadinessRecord>;
  save(input: {
    access: "superadmin";
    actorIdentityId: string;
    clinicId: string;
    expectedRevision: number;
    expectedConnectionUpdatedAt: Date | null;
    expectedGeneration: WhatsAppReadinessGeneration;
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
    expectedGeneration: WhatsAppReadinessGeneration;
    now: Date;
  }) => Promise<void>;
};

export type WhatsAppReadinessReconciliationProvider =
  WhatsAppReadinessProvider & {
    listPhoneNumbers?(customerId: string): Promise<
      Array<{
        businessAccountId: string | null;
        customerId: string;
        displayPhoneE164: string | null;
        phoneNumberId: string;
      }>
    >;
    ensurePhoneNumberWebhook(phoneNumberId: string): Promise<{
      remoteId: string;
      wasPaused?: boolean;
    }>;
    ensureProjectWebhook(): Promise<{
      remoteId: string;
      wasPaused?: boolean;
    }>;
  };

export type WhatsAppReadinessProvider = {
  getPhoneNumber?(phoneNumberId: string): Promise<
    | {
        businessAccountId: string | null;
        customerId: string;
        phoneNumberId: string;
      }
    | undefined
  >;
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
  const expectedConnectionUpdatedAt = state.connection?.updatedAt ?? null;
  const expectedGeneration =
    state.connection === null
      ? null
      : getWhatsAppReadinessGeneration(state.connection);

  if (input.action === "webhooks") {
    if (
      dependencies.store.retryWebhooks === undefined ||
      state.provisioningEventId === null ||
      expectedGeneration === null
    ) {
      throw new WhatsAppReadinessBlockedError(
        "La Conexión no tiene una generación de webhooks reintentable",
      );
    }
    await dependencies.store.retryWebhooks({
      actorIdentityId: input.actorIdentityId,
      clinicId: input.clinicId,
      eventId: state.provisioningEventId,
      expectedGeneration,
      now,
    });
    return getWhatsAppReadiness(access, dependencies.store);
  }

  let next = cloneState(state);
  next.reconciliation = {
    ...next.reconciliation,
    attempts: 0,
    lastError: null,
    nextAttemptAt: now,
    status: "pending",
  };

  try {
    assertConnectionForAction(next.connection, input.action);
    next = await applyAction(
      next,
      input.action,
      dependencies.provider,
      now,
      dependencies.store.withTemplateProvisioningLock,
    );
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
    if (next.connection !== null && expectedGeneration !== null) {
      assertReadinessGeneration(next, expectedGeneration);
      await dependencies.store.save({
        access: "superadmin",
        actorIdentityId: input.actorIdentityId,
        clinicId: input.clinicId,
        expectedRevision: state.revision ?? 0,
        expectedConnectionUpdatedAt,
        expectedGeneration,
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
  if (next.connection === null || expectedGeneration === null) {
    throw new WhatsAppReadinessConflictError();
  }
  assertReadinessGeneration(next, expectedGeneration);
  next = await dependencies.store.save({
    access: "superadmin",
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    expectedRevision: state.revision ?? 0,
    expectedConnectionUpdatedAt,
    expectedGeneration,
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
      next = await applyAction(
        next,
        action,
        dependencies.provider,
        now,
        dependencies.store.withTemplateProvisioningLock,
      );
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

  const finalSchedule = reconciliationScheduleAfterAttempt({
    attempts: 0,
    failure: retryableFailure === null ? null : new Error(retryableFailure),
    now,
    state: next,
    status: next.technicalStatus,
  });
  next = await saveProvisioningReadiness(
    {
      ...next,
      reconciliation: {
        attempts: finalSchedule.attempts,
        lastAttemptAt: now,
        lastError: finalSchedule.lastError,
        nextAttemptAt: finalSchedule.nextAttemptAt,
        status: finalSchedule.status,
      },
    },
    input,
    dependencies.store,
  );

  if (retryableFailure !== null && next.technicalStatus !== "blocked") {
    throw new WhatsAppReadinessRetryError(retryableFailure);
  }

  return toSnapshot(next, now);
}

export type WhatsAppReadinessReconciliationResult = {
  blocked: number;
  claimed: number;
  pending: number;
  retried: number;
  succeeded: number;
};

/**
 * Reconciles the current Kapso generation without replaying Embedded Signup.
 * The store owns the durable lease and generation check; this use case only
 * composes idempotent provider reads/writes and advances the next gate.
 */
export async function runWhatsAppReadinessReconciliation(
  input: { limit?: number; now: Date },
  dependencies: {
    provider: WhatsAppReadinessReconciliationProvider;
    store: WhatsAppReadinessReconciliationStore;
  },
): Promise<WhatsAppReadinessReconciliationResult> {
  const leases = await dependencies.store.claimDueReconciliations({
    limit: input.limit ?? 20,
    now: input.now,
  });
  const result: WhatsAppReadinessReconciliationResult = {
    blocked: 0,
    claimed: leases.length,
    pending: 0,
    retried: 0,
    succeeded: 0,
  };

  for (const lease of leases) {
    let state: WhatsAppReadinessRecord | undefined;
    try {
      state = await dependencies.store.readForReconciliation({
        clinicId: lease.clinicId,
        leaseToken: lease.leaseToken,
        now: input.now,
      });
      if (
        state.connection === null ||
        !isSameWhatsAppReadinessGeneration(
          getWhatsAppReadinessGeneration(state.connection),
          lease.expectedGeneration,
        )
      ) {
        throw new WhatsAppReadinessConflictError();
      }

      let next = cloneState(state);
      if (next.connection === null) {
        throw new WhatsAppReadinessConflictError();
      }
      let expectedGeneration = lease.expectedGeneration;
      let failure: unknown = null;
      const connectionBeforeAssociation = next.connection;
      if (
        connectionBeforeAssociation.provider === "kapso" &&
        connectionBeforeAssociation.phoneNumberId === null &&
        dependencies.provider.listPhoneNumbers !== undefined
      ) {
        try {
          const phoneNumbers = await dependencies.provider.listPhoneNumbers(
            connectionBeforeAssociation.customer,
          );
          const matches = phoneNumbers.filter(
            (phoneNumber) =>
              phoneNumber.customerId === connectionBeforeAssociation.customer,
          );
          if (matches.length > 1) {
            failure = new WhatsAppReadinessBlockedError(
              "Kapso devolvió más de un número para la Clínica; requiere intervención humana",
            );
          } else if (matches.length === 1) {
            const phoneNumber = matches[0]!;
            const associatedConnection = {
              ...connectionBeforeAssociation,
              businessAccountId:
                phoneNumber.businessAccountId ??
                connectionBeforeAssociation.businessAccountId,
              metadata: {
                ...connectionBeforeAssociation.metadata,
                displayPhoneE164:
                  phoneNumber.displayPhoneE164 ??
                  connectionBeforeAssociation.metadata.displayPhoneE164 ??
                  null,
                nextAction: "Confirmar webhooks de WhatsApp",
                statusReason:
                  "Kapso confirmó el número durante la reconciliación",
              },
              phoneNumberE164:
                phoneNumber.displayPhoneE164 ??
                connectionBeforeAssociation.phoneNumberE164,
              phoneNumberId: phoneNumber.phoneNumberId,
              status: "provisioning" as const,
              updatedAt: input.now,
            };
            next = {
              ...next,
              connection: associatedConnection,
            };
            expectedGeneration =
              getWhatsAppReadinessGeneration(associatedConnection);
          }
        } catch (error) {
          failure = error;
        }
      }
      const connectionForBusinessAccount = next.connection;
      if (
        failure === null &&
        connectionForBusinessAccount?.provider === "kapso" &&
        connectionForBusinessAccount.phoneNumberId !== null &&
        connectionForBusinessAccount.businessAccountId === null &&
        dependencies.provider.getPhoneNumber !== undefined
      ) {
        try {
          const phoneNumber = await dependencies.provider.getPhoneNumber(
            connectionForBusinessAccount.phoneNumberId,
          );
          if (phoneNumber === undefined) {
            failure = new WhatsAppReadinessBlockedError(
              "Kapso ya no encuentra el número asociado a la Clínica",
            );
          } else if (
            phoneNumber.phoneNumberId !==
              connectionForBusinessAccount.phoneNumberId ||
            phoneNumber.customerId !== connectionForBusinessAccount.customer
          ) {
            failure = new WhatsAppReadinessBlockedError(
              "La asociación del número de Kapso no coincide con la Clínica",
            );
          } else if (phoneNumber.businessAccountId === null) {
            failure = new WhatsAppReadinessBlockedError(
              "Kapso todavía no confirmó el Business Account de la Clínica",
            );
          } else {
            const associatedConnection = {
              ...connectionForBusinessAccount,
              businessAccountId: phoneNumber.businessAccountId,
              metadata: {
                ...connectionForBusinessAccount.metadata,
                nextAction: "Confirmar webhooks de WhatsApp",
                statusReason:
                  "Kapso confirmó el Business Account durante la reconciliación",
              },
              status: "provisioning" as const,
              updatedAt: input.now,
            };
            next = { ...next, connection: associatedConnection };
            expectedGeneration =
              getWhatsAppReadinessGeneration(associatedConnection);
          }
        } catch (error) {
          failure = error;
        }
      }
      if (
        failure === null &&
        next.connection !== null &&
        next.connection.provider === "kapso" &&
        next.connection.phoneNumberId !== null
      ) {
        const webhookResult = await reconcileWebhooks(
          next,
          dependencies.provider,
          input.now,
        );
        next = webhookResult.state;
        failure = webhookResult.error;
      }
      next = withDerivedState(
        next,
        input.now,
        allowsAutomaticConnectionRecovery(next),
        true,
      );
      const connectionAfterDerived = next.connection;

      if (
        failure === null &&
        connectionAfterDerived !== null &&
        connectionAfterDerived.status !== "blocked" &&
        connectionAfterDerived.status !== "disconnected" &&
        connectionAfterDerived.phoneNumberId !== null &&
        needsHealthRefresh(next, input.now)
      ) {
        const refreshed = await reconcileAction(
          next,
          "reactivate",
          dependencies.provider,
          input.now,
          dependencies.store.withTemplateProvisioningLock,
        );
        next = refreshed.state;
        failure = refreshed.error;
        next = withDerivedState(
          next,
          input.now,
          allowsAutomaticConnectionRecovery(next),
          true,
        );
      }

      for (const action of ["templates", "billing", "e2e"] as const) {
        if (
          failure !== null ||
          next.connection?.phoneNumberId === null ||
          !canReconcileAction(next, action, input.now)
        ) {
          break;
        }
        const reconciled = await reconcileAction(
          next,
          action,
          dependencies.provider,
          input.now,
          dependencies.store.withTemplateProvisioningLock,
        );
        next = reconciled.state;
        failure = reconciled.error;
        next = withDerivedState(
          next,
          input.now,
          allowsAutomaticConnectionRecovery(next),
          true,
        );
      }

      const evaluated = evaluateWhatsAppReadiness(
        toEvaluationInput(
          next,
          allowsAutomaticConnectionRecovery(next),
          input.now,
        ),
      );
      const schedule = reconciliationScheduleAfterAttempt({
        attempts: lease.attempts,
        failure,
        now: input.now,
        state: next,
        status: evaluated.status,
      });
      next = {
        ...next,
        reconciliation: {
          attempts: schedule.attempts,
          lastAttemptAt: input.now,
          lastError: schedule.lastError,
          nextAttemptAt: schedule.nextAttemptAt,
          status: schedule.status,
        },
      };
      const persisted = await dependencies.store.saveForReconciliation({
        clinicId: lease.clinicId,
        claimedGeneration: lease.claimedGeneration,
        expectedGeneration,
        leaseToken: lease.leaseToken,
        now: input.now,
        state: next,
      });
      await syncReadinessAlerts(dependencies.store, persisted, input.now, {
        access: "reconciliation-worker",
        leaseToken: lease.leaseToken,
      });
      await dependencies.store.completeReconciliation({
        attempts: schedule.attempts,
        clinicId: lease.clinicId,
        lastError: schedule.lastError,
        leaseToken: lease.leaseToken,
        nextAttemptAt: schedule.nextAttemptAt,
        now: input.now,
        status: schedule.status,
      });

      if (schedule.status === "succeeded") result.succeeded += 1;
      else if (schedule.status === "blocked") result.blocked += 1;
      else result.pending += 1;
      if (failure !== null && schedule.status === "pending")
        result.retried += 1;
    } catch (error) {
      const retryable = isRetryableReadinessError(error);
      const attempts = lease.attempts;
      const status: WhatsAppReadinessReconciliationStatus =
        retryable && attempts < whatsappReadinessReconciliationMaxAttempts
          ? "pending"
          : "blocked";
      const nextAttemptAt =
        status === "pending"
          ? nextWhatsAppReadinessReconciliationAttemptAt(input.now, attempts)
          : null;
      if (state !== undefined) {
        const failureState = {
          ...state,
          reconciliation: {
            ...state.reconciliation,
            attempts,
            lastAttemptAt: input.now,
            lastError: toErrorMessage(error),
            nextAttemptAt,
            status,
          },
        };
        try {
          await syncReadinessAlerts(
            dependencies.store,
            failureState,
            input.now,
            {
              access: "reconciliation-worker",
              leaseToken: lease.leaseToken,
            },
          );
        } catch {
          // The durable reconciliation error remains visible even if alert
          // persistence is unavailable in this attempt.
        }
      }
      try {
        await dependencies.store.completeReconciliation({
          attempts,
          clinicId: lease.clinicId,
          lastError: toErrorMessage(error),
          leaseToken: lease.leaseToken,
          nextAttemptAt,
          now: input.now,
          status,
        });
      } catch (completionError) {
        if (completionError instanceof WhatsAppReadinessConflictError) {
          // A newer reconciliation owns this clinic's state now.
          result.retried += 1;
          continue;
        }
        throw completionError;
      }
      if (status === "pending") {
        result.pending += 1;
        result.retried += 1;
      } else {
        result.blocked += 1;
      }
    }
  }

  return result;
}

function canReconcileAction(
  state: WhatsAppReadinessRecord,
  action: "templates" | "billing" | "e2e",
  now: Date,
) {
  const gates = evaluateWhatsAppReadiness(
    toEvaluationInput(state, allowsAutomaticConnectionRecovery(state), now),
  ).gates;
  if (gates.some((gate) => gate.status === "blocked")) return false;
  if (action === "templates") {
    return gates.find((gate) => gate.code === "templates")?.status !== "ready";
  }
  if (gates.find((gate) => gate.code === "templates")?.status !== "ready") {
    return false;
  }
  if (action === "billing") {
    return gates.find((gate) => gate.code === "billing")?.status !== "ready";
  }
  return (
    gates.find((gate) => gate.code === "billing")?.status === "ready" &&
    gates.find((gate) => gate.code === "e2e")?.status !== "ready"
  );
}

function needsHealthRefresh(state: WhatsAppReadinessRecord, now: Date) {
  return (
    state.numberHealthCheckedAt === null ||
    now.valueOf() - state.numberHealthCheckedAt.valueOf() >=
      whatsappNumberHealthMaxAgeMs
  );
}

function allowsAutomaticConnectionRecovery(state: WhatsAppReadinessRecord) {
  return (
    state.connection?.status !== "blocked" &&
    state.connection?.status !== "disconnected"
  );
}

async function reconcileAction(
  state: WhatsAppReadinessRecord,
  action: WhatsAppReadinessAction,
  provider: WhatsAppReadinessProvider,
  now: Date,
  withTemplateProvisioningLock: WhatsAppTemplateProvisioningLock["withTemplateProvisioningLock"],
) {
  try {
    return {
      error: null,
      state: await applyAction(
        state,
        action,
        provider,
        now,
        withTemplateProvisioningLock,
      ),
    };
  } catch (error) {
    const statePatch =
      error instanceof WhatsAppReadinessBlockedError
        ? error.statePatch
        : undefined;
    return {
      error,
      state:
        statePatch === undefined
          ? markActionFailed(state, action, error, now)
          : { ...state, ...statePatch },
    };
  }
}

async function reconcileWebhooks(
  state: WhatsAppReadinessRecord,
  provider: WhatsAppReadinessReconciliationProvider,
  now: Date,
) {
  let next = state;
  try {
    const project = await provider.ensureProjectWebhook();
    next = {
      ...next,
      projectWebhook: {
        lastAttemptAt: now,
        lastError: null,
        remoteId: project.remoteId,
        status: "ready",
      },
    };
    const phoneNumberId = next.connection?.phoneNumberId;
    if (phoneNumberId === null || phoneNumberId === undefined) {
      throw new WhatsAppReadinessBlockedError(
        "Kapso todavía no confirmó el phone_number_id de la Clínica",
      );
    }
    const phone = await provider.ensurePhoneNumberWebhook(phoneNumberId);
    next = {
      ...next,
      phoneNumberWebhook: {
        lastAttemptAt: now,
        lastError: null,
        remoteId: phone.remoteId,
        status: "ready",
      },
    };
    return { error: null, state: next };
  } catch (error) {
    const isProjectMissing = next.projectWebhook.status !== "ready";
    return {
      error,
      state: {
        ...next,
        ...(isProjectMissing
          ? {
              projectWebhook: {
                ...next.projectWebhook,
                lastAttemptAt: now,
                lastError: toErrorMessage(error),
                status: "failed" as const,
              },
            }
          : {
              phoneNumberWebhook: {
                ...next.phoneNumberWebhook,
                lastAttemptAt: now,
                lastError: toErrorMessage(error),
                status: "failed" as const,
              },
            }),
      },
    };
  }
}

function reconciliationScheduleAfterAttempt(input: {
  attempts: number;
  failure: unknown;
  now: Date;
  state: WhatsAppReadinessRecord;
  status: WhatsAppTechnicalReadinessStatus;
}) {
  if (input.failure !== null) {
    const retryable = isRetryableReadinessError(input.failure);
    const blocked =
      !retryable ||
      input.attempts >= whatsappReadinessReconciliationMaxAttempts;
    return {
      attempts: input.attempts,
      lastError: toErrorMessage(input.failure),
      nextAttemptAt: blocked
        ? null
        : nextWhatsAppReadinessReconciliationAttemptAt(
            input.now,
            input.attempts,
          ),
      status: (blocked
        ? "blocked"
        : "pending") as WhatsAppReadinessReconciliationStatus,
    };
  }
  if (
    input.status === "blocked" ||
    input.state.connection?.status === "blocked" ||
    input.state.connection?.status === "disconnected"
  ) {
    return {
      attempts: 0,
      lastError: input.state.statusReason,
      nextAttemptAt: null,
      status: "blocked" as const,
    };
  }
  if (input.status === "ready") {
    return {
      attempts: 0,
      lastError: null,
      nextAttemptAt: nextWhatsAppReadinessHealthCheckAt(
        input.now,
        input.state.numberHealthCheckedAt,
        whatsappNumberHealthMaxAgeMs,
      ),
      status: "succeeded" as const,
    };
  }
  return {
    attempts: 0,
    lastError: null,
    nextAttemptAt: nextWhatsAppReadinessPendingAt(input.now),
    status: "pending" as const,
  };
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
    now: input.now,
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
    | { access: "provisioning-worker"; leaseToken: string }
    | { access: "reconciliation-worker"; leaseToken: string },
) {
  if (store.syncAlerts === undefined || state.provisioningEventId === null) {
    return;
  }
  const evaluated = evaluateWhatsAppReadiness(
    toEvaluationInput(state, false, now),
  );
  const firstIncompleteCode = evaluated.gates.find(
    (gate) => gate.status !== "ready",
  )?.code;
  await store.syncAlerts({
    ...access,
    clinicId: state.clinicId,
    gates: evaluated.gates.map((gate) =>
      toAlertGate(gate, state, gate.code === firstIncompleteCode),
    ),
    now,
    provisioningEventId: state.provisioningEventId,
  });
}

function toAlertGate(
  gate: WhatsAppReadinessGate,
  state: WhatsAppReadinessRecord,
  includeReconciliationError = false,
): WhatsAppConnectionAlertGate {
  const detail =
    readinessGateLastError(state, gate.code) ??
    (includeReconciliationError ? state.reconciliation.lastError : null);
  return {
    action: gate.action,
    code: gate.code,
    message:
      detail !== null && !gate.message.includes(detail)
        ? `${gate.message}: ${detail}`
        : gate.message,
    status:
      detail !== null && gate.status === "pending" ? "failed" : gate.status,
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
  if (
    action !== "e2e" &&
    action !== "reactivate" &&
    connection.businessAccountId == null
  ) {
    throw new WhatsAppReadinessBlockedError(
      "Kapso todavía no confirmó el Business Account de la Clínica",
    );
  }
}

function assertReadinessGeneration(
  state: WhatsAppReadinessRecord,
  expectedGeneration: WhatsAppReadinessGeneration,
) {
  if (
    state.connection === null ||
    !isSameWhatsAppReadinessGeneration(
      getWhatsAppReadinessGeneration(state.connection),
      expectedGeneration,
    ) ||
    state.projectId !== expectedGeneration.projectId ||
    state.provisioningEventId !== expectedGeneration.provisioningEventId
  ) {
    throw new WhatsAppReadinessConflictError();
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
  withTemplateProvisioningLock: WhatsAppTemplateProvisioningLock["withTemplateProvisioningLock"],
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
    const businessAccountId = requireBusinessAccountId(connection);
    const phoneNumberId = connection.phoneNumberId;
    const syncTemplates = () =>
      provider.syncTemplates({
        businessAccountId,
        phoneNumberId,
      });
    const result =
      withTemplateProvisioningLock === undefined
        ? await syncTemplates()
        : await withTemplateProvisioningLock({
            businessAccountId,
            operation: syncTemplates,
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
    if (!isWhatsAppNumberMessagingAvailable(result.numberHealth)) {
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
  if (error instanceof WhatsAppReadinessConflictError) return true;
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
  const numberHealth = currentWhatsAppNumberHealth({
    health: state.numberHealth,
    healthCheckedAt: state.numberHealthCheckedAt,
    now,
  });
  const currentState = { ...state, numberHealth };
  const readiness = evaluateWhatsAppReadiness(
    toEvaluationInput(currentState, allowConnectionRecovery, now),
  );
  const templatesGate = readiness.gates.find(
    (gate) => gate.code === "templates",
  );
  const billingGate = readiness.gates.find((gate) => gate.code === "billing");
  const webhookGate = readiness.gates.find((gate) => gate.code === "webhooks");
  const connection =
    currentState.connection === null
      ? null
      : {
          ...currentState.connection,
          lastTestAt: currentState.e2e.lastTestAt,
          metadata: {
            ...currentState.connection.metadata,
            billingStatus: billingGate?.status ?? null,
            health: currentState.numberHealth,
            nextAction: readiness.nextAction,
            statusReason: readiness.statusReason,
            templatesStatus: templatesGate?.status ?? null,
            webhookStatus: webhookGate?.status ?? null,
          },
          status: connectionStatusForReadiness(
            currentState.connection.status,
            readiness.status,
          ),
          updatedAt: touchConnection ? now : currentState.connection.updatedAt,
        };

  return {
    ...currentState,
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
  const numberHealth = currentWhatsAppNumberHealth({
    health: state.numberHealth,
    healthCheckedAt: state.numberHealthCheckedAt,
    now,
  });
  const currentState = { ...state, numberHealth };
  return {
    ...currentState,
    billingHealth: evaluateWhatsAppBillingHealth({
      creditCents: currentState.billing.creditCents,
      creditLimitCents: currentState.billing.creditLimitCents ?? null,
      criticalAutonomyDays: currentState.billing.criticalAutonomyDays,
      criticalBalancePercent: currentState.billing.criticalBalancePercent,
      estimatedDailyConsumptionCents:
        currentState.billing.estimatedDailyConsumptionCents ?? 0,
      warningAutonomyDays: currentState.billing.warningAutonomyDays,
      warningBalancePercent: currentState.billing.warningBalancePercent,
    }),
    readiness: evaluateWhatsAppReadiness(
      toEvaluationInput(currentState, false, now),
    ),
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
    reconciliation: { ...state.reconciliation },
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
