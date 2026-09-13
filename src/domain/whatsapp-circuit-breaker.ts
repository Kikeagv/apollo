export const whatsappCircuitBreakerCauses = [
  "webhook-paused",
  "high-failure-rate",
  "credit-exhausted",
  "quota-exhausted",
  "provider-error",
  "meta-error",
  "legal-block",
] as const;

export type WhatsAppCircuitBreakerCause =
  (typeof whatsappCircuitBreakerCauses)[number];

export const whatsappCircuitBreakerStatuses = ["closed", "open"] as const;
export type WhatsAppCircuitBreakerStatus =
  (typeof whatsappCircuitBreakerStatuses)[number];

export type WhatsAppCircuitBreakerState = {
  clinicId: string;
  cause: WhatsAppCircuitBreakerCause | null;
  failureCount: number;
  failureWindowStartedAt: Date | null;
  lastFailureAt: Date | null;
  lastReactivatedAt: Date | null;
  lastReactivatedByIdentityId: string | null;
  lastSyntheticEvidence: string | null;
  lastSyntheticTestAt: Date | null;
  lastSyntheticTestStatus: "passed" | "failed" | null;
  lastTransitionAt: Date;
  nextAction: string;
  openedAt: Date | null;
  reason: string;
  revision: number;
  status: WhatsAppCircuitBreakerStatus;
  updatedAt: Date;
};

export type WhatsAppUsageMetric = {
  category:
    | "message"
    | "media"
    | "template"
    | "interactive"
    | "reaction"
    | "read-receipt";
  direction: "inbound" | "outbound";
};

export const whatsappCircuitBreakerFailurePolicy = {
  failureThreshold: 3,
  failureWindowMs: 5 * 60_000,
} as const;

export const whatsappBillingThresholdPolicy = {
  warningBalancePercent: 20,
  criticalBalancePercent: 10,
  warningAutonomyDays: 7,
  criticalAutonomyDays: 3,
} as const;

export type WhatsAppBillingHealth = {
  autonomyDays: number | null;
  balancePercent: number | null;
  level: "normal" | "warning" | "critical";
  reason: "balance" | "autonomy" | "balance-and-autonomy" | "none";
};

export function shouldOpenWhatsAppCircuit(input: {
  failureCount: number;
  now: Date;
  threshold?: number;
  windowMs?: number;
  windowStartedAt: Date | null;
}) {
  const threshold =
    input.threshold ?? whatsappCircuitBreakerFailurePolicy.failureThreshold;
  const windowMs =
    input.windowMs ?? whatsappCircuitBreakerFailurePolicy.failureWindowMs;
  return (
    input.failureCount >= threshold &&
    input.windowStartedAt !== null &&
    input.now.valueOf() - input.windowStartedAt.valueOf() <= windowMs
  );
}

export function countWhatsAppQuotaMessages(metrics: WhatsAppUsageMetric[]) {
  return metrics.filter((metric) => metric.category !== "read-receipt").length;
}

/**
 * Reconciles a provider quota snapshot with locally reserved/consumed sends.
 * A newer provider period is the only safe signal that the monthly counter
 * rolled over; otherwise local consumption must never move backwards.
 */
export function reconcileWhatsAppQuotaConsumption(input: {
  incomingConsumed: number;
  incomingPeriod: string | null | undefined;
  incomingSnapshotIsOlder: boolean;
  persistedConsumed: number;
  persistedPeriod: string | null | undefined;
}) {
  const incomingConsumed = Math.max(0, input.incomingConsumed);
  const persistedConsumed = Math.max(0, input.persistedConsumed);
  if (input.incomingSnapshotIsOlder) return persistedConsumed;

  const incomingPeriod = input.incomingPeriod ?? null;
  const persistedPeriod = input.persistedPeriod ?? null;
  if (
    incomingPeriod !== null &&
    (persistedPeriod === null || incomingPeriod > persistedPeriod)
  ) {
    return incomingConsumed;
  }
  return Math.max(persistedConsumed, incomingConsumed);
}

/** Conserva una razón operativa breve sin aceptar secretos ni payloads crudos. */
export function sanitizeWhatsAppOperationalText(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(
      /((?:authorization|x-api-key|api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*)(?:Bearer\s+)?\S+/gi,
      "$1[redacted]",
    )
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .trim()
    .slice(0, 1_000);
}

export function evaluateWhatsAppBillingHealth(input: {
  creditCents: number;
  creditLimitCents: number | null;
  estimatedDailyConsumptionCents: number;
  warningBalancePercent?: number;
  criticalBalancePercent?: number;
  warningAutonomyDays?: number;
  criticalAutonomyDays?: number;
}): WhatsAppBillingHealth {
  const balancePercent =
    input.creditLimitCents === null || input.creditLimitCents <= 0
      ? null
      : Math.round((input.creditCents / input.creditLimitCents) * 100);
  const autonomyDays =
    input.estimatedDailyConsumptionCents > 0
      ? Math.floor(input.creditCents / input.estimatedDailyConsumptionCents)
      : null;
  const warningBalancePercent =
    input.warningBalancePercent ??
    whatsappBillingThresholdPolicy.warningBalancePercent;
  const criticalBalancePercent =
    input.criticalBalancePercent ??
    whatsappBillingThresholdPolicy.criticalBalancePercent;
  const warningAutonomyDays =
    input.warningAutonomyDays ??
    whatsappBillingThresholdPolicy.warningAutonomyDays;
  const criticalAutonomyDays =
    input.criticalAutonomyDays ??
    whatsappBillingThresholdPolicy.criticalAutonomyDays;
  const criticalBalance =
    balancePercent !== null && balancePercent <= criticalBalancePercent;
  const criticalAutonomy =
    autonomyDays !== null && autonomyDays <= criticalAutonomyDays;
  const warningBalance =
    balancePercent !== null && balancePercent <= warningBalancePercent;
  const warningAutonomy =
    autonomyDays !== null && autonomyDays <= warningAutonomyDays;

  if (criticalBalance || criticalAutonomy) {
    return {
      autonomyDays,
      balancePercent,
      level: "critical",
      reason:
        criticalBalance && criticalAutonomy
          ? "balance-and-autonomy"
          : criticalBalance
            ? "balance"
            : "autonomy",
    };
  }
  if (warningBalance || warningAutonomy) {
    return {
      autonomyDays,
      balancePercent,
      level: "warning",
      reason:
        warningBalance && warningAutonomy
          ? "balance-and-autonomy"
          : warningBalance
            ? "balance"
            : "autonomy",
    };
  }
  return {
    autonomyDays,
    balancePercent,
    level: "normal",
    reason: "none",
  };
}

export function canReactivateWhatsAppCircuit(input: {
  causeFixed: boolean;
  manualConfirmation: boolean;
  state: WhatsAppCircuitBreakerState;
  syntheticTestPassed: boolean;
}) {
  return (
    input.state.status === "open" &&
    input.causeFixed &&
    input.syntheticTestPassed &&
    input.manualConfirmation
  );
}

export function defaultWhatsAppCircuitBreakerState(
  clinicId: string,
  now = new Date(),
): WhatsAppCircuitBreakerState {
  return {
    clinicId,
    cause: null,
    failureCount: 0,
    failureWindowStartedAt: null,
    lastFailureAt: null,
    lastReactivatedAt: null,
    lastReactivatedByIdentityId: null,
    lastSyntheticEvidence: null,
    lastSyntheticTestAt: null,
    lastSyntheticTestStatus: null,
    lastTransitionAt: now,
    nextAction: "La Conexión opera normalmente",
    openedAt: null,
    reason: "Circuito cerrado",
    revision: 0,
    status: "closed",
    updatedAt: now,
  };
}
