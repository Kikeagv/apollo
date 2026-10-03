import {
  parseKapsoDeliveryStatusPayload,
  type KapsoDeliveryStatusEventName,
} from "~/domain/whatsapp-delivery-events";
import type { TransactionalDeliveryCallbackStore } from "./transactional-deliveries";
import {
  persistWhatsAppOperationalMetric,
  type WhatsAppOperationalObserver,
} from "./whatsapp-circuit-breaker";

export class TransactionalDeliveryStatusNotFoundError extends Error {
  constructor() {
    super("El estado Kapso no corresponde a una Entrega conocida");
    this.name = "TransactionalDeliveryStatusNotFoundError";
  }
}

const STATUS_MAX_ATTEMPTS = 5;

export type TransactionalDeliveryStatusEvent = {
  attempts: number;
  eventName: KapsoDeliveryStatusEventName;
  id: string;
  idempotencyKey: string;
  leaseToken: string | null;
  payload: Record<string, unknown>;
  receivedAt: Date;
  status: "pending" | "processing";
};

export type TransactionalDeliveryStatusStore = {
  claimDueStatusEvents(input: {
    limit: number;
    now: Date;
  }): Promise<TransactionalDeliveryStatusEvent[]>;
  markStatusProcessed(input: {
    eventId: string;
    leaseToken: string;
    processedAt: Date;
  }): Promise<void>;
  markStatusRejected(input: {
    eventId: string;
    leaseToken: string;
    processedAt: Date;
    reason: string;
  }): Promise<void>;
  scheduleStatusRetry(input: {
    eventId: string;
    leaseToken: string;
    nextAttemptAt: Date;
    reason: string;
    retriedAt: Date;
  }): Promise<void>;
};

export async function runTransactionalDeliveryStatusWorker(
  input: { limit?: number; now: Date },
  queue: TransactionalDeliveryStatusStore,
  callbackStore: TransactionalDeliveryCallbackStore,
  observer?: WhatsAppOperationalObserver,
) {
  const events = await queue.claimDueStatusEvents({
    limit: input.limit ?? 50,
    now: input.now,
  });
  let processed = 0;
  let rejected = 0;
  let retried = 0;
  for (const event of events) {
    const leaseToken = requireLeaseToken(event);
    try {
      const status = parseKapsoDeliveryStatusPayload(
        event.eventName,
        event.payload,
      );
      const observation = await callbackStore.recordProviderCallback({
        ...(status.correlationKey === null
          ? {}
          : { idempotencyKey: status.correlationKey }),
        phoneNumberId: status.phoneNumberId,
        providerEventReceivedAt: event.receivedAt,
        providerMessageId: status.messageId,
        providerEventId: event.id,
        ...(status.error === null ? {} : { error: status.error }),
        status: status.status,
      });
      if (observation !== undefined && observer !== undefined) {
        await persistWhatsAppOperationalMetric(observer, {
          clinicId: observation.clinicId,
          errorCode: observation.errorCode,
          idempotencyKey: observation.idempotencyKey,
          latencyMs: null,
          metric: observation.metric,
          occurredAt: input.now,
          operation: observation.operation,
          outcome: observation.outcome,
          templateName: observation.templateName,
          workerKind: "delivery-status",
        });
        if (observation.isNew !== false && observation.outcome === "failed") {
          await observer.recordFailure({
            cause: "high-failure-rate",
            clinicId: observation.clinicId,
            now: input.now,
            reason: status.error ?? "Kapso reportó fallo de Entrega",
            workerKind: "delivery-status",
          });
        }
      }
      await queue.markStatusProcessed({
        eventId: event.id,
        leaseToken,
        processedAt: input.now,
      });
      processed += 1;
    } catch (error) {
      const reason = toErrorMessage(error);
      if (
        error instanceof Error &&
        (isPermanentStatusError(error) ||
          (isNotFoundStatusError(error) &&
            event.attempts >= STATUS_MAX_ATTEMPTS))
      ) {
        await queue.markStatusRejected({
          eventId: event.id,
          leaseToken,
          processedAt: input.now,
          reason,
        });
        rejected += 1;
        continue;
      }
      await queue.scheduleStatusRetry({
        eventId: event.id,
        leaseToken,
        nextAttemptAt: new Date(
          input.now.valueOf() + statusRetryDelay(event.attempts),
        ),
        reason,
        retriedAt: input.now,
      });
      retried += 1;
    }
  }
  return { claimed: events.length, processed, rejected, retried };
}

function requireLeaseToken(event: { leaseToken: string | null }) {
  if (event.leaseToken === null)
    throw new Error("Falta la concesión del estado Kapso");
  return event.leaseToken;
}

function statusRetryDelay(attempts: number) {
  return Math.min(15 * 60_000, 10_000 * 2 ** Math.max(0, attempts - 1));
}

function isPermanentStatusError(error: Error) {
  return error.name === "KapsoDeliveryStatusEventError";
}

function isNotFoundStatusError(error: Error) {
  return error.name === "TransactionalDeliveryStatusNotFoundError";
}

function toErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 1_000)
    : "Estado Kapso inválido";
}
