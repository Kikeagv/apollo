export const whatsappReadinessReconciliationMaxAttempts = 3;
export const whatsappReadinessReconciliationRetryDelaysMs = [
  10_000, 40_000,
] as const;
export const whatsappReadinessReconciliationPendingPollMs = 5 * 60_000;

export type WhatsAppReadinessReconciliationStatus =
  "blocked" | "pending" | "processing" | "succeeded";

export type WhatsAppReadinessReconciliation = {
  attempts: number;
  lastAttemptAt: Date | null;
  lastError: string | null;
  nextAttemptAt: Date | null;
  status: WhatsAppReadinessReconciliationStatus;
};

export type WhatsAppReadinessReconciliationSchedule = {
  nextAttemptAt: Date | null;
  status: WhatsAppReadinessReconciliationStatus;
};

export function nextWhatsAppReadinessReconciliationAttemptAt(
  now: Date,
  attempts: number,
) {
  if (attempts >= whatsappReadinessReconciliationMaxAttempts) return null;
  const delay =
    whatsappReadinessReconciliationRetryDelaysMs[Math.max(0, attempts - 1)] ??
    whatsappReadinessReconciliationRetryDelaysMs.at(-1)!;
  return new Date(now.valueOf() + delay);
}

export function nextWhatsAppReadinessHealthCheckAt(
  now: Date,
  healthCheckedAt: Date | null,
  maxAgeMs: number,
) {
  const next =
    healthCheckedAt === null
      ? now
      : new Date(healthCheckedAt.valueOf() + maxAgeMs);
  return next < now ? now : next;
}

/**
 * A successful remote read can still leave a gate waiting for a provider-side
 * transition, such as template approval. Keep polling that state without
 * treating it as a failed provider attempt.
 */
export function nextWhatsAppReadinessPendingAt(now: Date) {
  return new Date(now.valueOf() + whatsappReadinessReconciliationPendingPollMs);
}

export function isWhatsAppReadinessReconciliationDue(
  schedule: WhatsAppReadinessReconciliationSchedule,
  now: Date,
) {
  return (
    (schedule.status === "pending" || schedule.status === "succeeded") &&
    (schedule.nextAttemptAt === null || schedule.nextAttemptAt <= now)
  );
}
