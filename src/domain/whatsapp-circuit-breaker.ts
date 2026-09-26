import type {
  WhatsAppSyntheticSmokeResult,
  WhatsAppSyntheticSmokeStep,
} from "./whatsapp-smoke";
import type { WhatsAppProviderId } from "./whatsapp-runtime";

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
  openedBy: {
    actorIdentityId: string | null;
    actorKind: "superadmin" | "system" | "worker";
    displayName: string | null;
  } | null;
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
      /([a-z][a-z\d+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
      "$1[redacted]@",
    )
    .replace(
      /((?:["']?(?:authorization|x-api-key|api[_-]?key|access[_-]?token|secret|password)["']?)\s*[:=]\s*["']?)(?:Bearer\s+)?([^\"',}\s]+)(["']?)/gi,
      "$1[redacted]$3",
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

export type WhatsAppCircuitReactivationSmoke = Pick<
  WhatsAppSyntheticSmokeResult,
  | "controlledTestContact"
  | "evidence"
  | "providerTransportVerified"
  | "realPatientsEnabled"
  | "requireRealRoundtrip"
  | "status"
  | "steps"
  | "syntheticContact"
> & {
  finishedAt: Date | null;
  id: string;
  provisioningEventId: string | null;
  startedAt: Date;
};

export const whatsappCircuitReactivationEvidenceMaxAgeMs = 5 * 60_000;

/** Solo acepta el smoke completo, vigente y ligado a la generación actual. */
export function evaluateWhatsAppCircuitReactivationEvidence(input: {
  connectionGenerationId: string | null;
  connectionProvider: WhatsAppProviderId;
  now: Date;
  smoke: WhatsAppCircuitReactivationSmoke | null;
}): { reason: string; valid: boolean } {
  const smoke = input.smoke;
  if (smoke?.status !== "passed" || smoke.finishedAt === null) {
    return {
      reason:
        "Ejecute y complete una prueba E2E antes de reactivar la Conexión",
      valid: false,
    };
  }
  if (sanitizeWhatsAppOperationalText(smoke.evidence ?? "") === "") {
    return {
      reason: "La prueba E2E aprobada no conserva evidencia verificable",
      valid: false,
    };
  }
  if (smoke.realPatientsEnabled) {
    return {
      reason: "La prueba E2E no puede habilitar Pacientes reales",
      valid: false,
    };
  }
  const evidenceAge = input.now.valueOf() - smoke.finishedAt.valueOf();
  if (
    evidenceAge < 0 ||
    evidenceAge > whatsappCircuitReactivationEvidenceMaxAgeMs ||
    smoke.finishedAt.valueOf() < smoke.startedAt.valueOf()
  ) {
    return {
      reason: "La evidencia E2E expiró; ejecute una prueba nueva",
      valid: false,
    };
  }
  if (
    input.connectionGenerationId !== smoke.provisioningEventId ||
    (input.connectionProvider === "kapso" &&
      input.connectionGenerationId === null)
  ) {
    return {
      reason:
        "La prueba E2E no corresponde a la generación actual de la Conexión",
      valid: false,
    };
  }
  if (input.connectionProvider === "kapso") {
    if (
      smoke.requireRealRoundtrip !== true ||
      smoke.controlledTestContact !== true ||
      smoke.syntheticContact ||
      smoke.providerTransportVerified !== true ||
      !hasVerifiedCircuitReactivationRoundtrip(smoke.steps)
    ) {
      return {
        reason:
          "La prueba E2E no conserva el roundtrip real verificado del proveedor",
        valid: false,
      };
    }
  } else if (!smoke.syntheticContact) {
    return {
      reason: "La prueba E2E requiere un Contacto sintético",
      valid: false,
    };
  }
  return { reason: "Evidencia E2E vigente y válida", valid: true };
}

function hasVerifiedCircuitReactivationRoundtrip(
  steps: WhatsAppSyntheticSmokeStep[],
) {
  const roundtripSources = {
    "real-reception": "provider",
    "real-processing": "application",
    "real-response": "provider",
    "real-delivery": "provider",
  } as const;
  return Object.entries(roundtripSources).every(([code, source]) => {
    const step = steps.find((candidate) => candidate.code === code);
    return (
      step?.status === "passed" &&
      step.passed &&
      step.source === source &&
      step.evidence !== null &&
      step.eventId !== null &&
      step.observedAt !== null
    );
  });
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
    openedBy: null,
    lastTransitionAt: now,
    nextAction: "La Conexión opera normalmente",
    openedAt: null,
    reason: "Circuito cerrado",
    revision: 0,
    status: "closed",
    updatedAt: now,
  };
}
