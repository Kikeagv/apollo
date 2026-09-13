import type { WhatsAppInboundReplySender } from "./whatsapp-inbound";
import {
  persistWhatsAppOperationalMetric,
  WhatsAppOperationalMetricPersistenceError,
  type WhatsAppOperationalObserver,
} from "./whatsapp-circuit-breaker";
import { WhatsAppCircuitBreakerOpenError } from "./whatsapp-provider";
import type { WhatsAppSendResult } from "./whatsapp-provider";

export type WhatsAppOutboundReply = Parameters<
  WhatsAppInboundReplySender["send"]
>[0] & {
  attempts: number;
  id: string;
  leaseToken: string | null;
};

export type WhatsAppOutboundReplyStore = {
  claimDueReplies(input: {
    limit: number;
    now: Date;
  }): Promise<WhatsAppOutboundReply[]>;
  markAcceptedReply(input: {
    id: string;
    leaseToken: string;
    now: Date;
    providerMessageId: string;
  }): Promise<void>;
  markFailedReply(input: {
    id: string;
    leaseToken: string;
    now: Date;
    reason: string;
  }): Promise<void>;
  markUnknownReply(input: {
    id: string;
    leaseToken: string;
    now: Date;
    reason: string;
  }): Promise<void>;
  deferReplyForCircuit?(input: {
    id: string;
    leaseToken: string;
    now: Date;
    reason: string;
  }): Promise<void>;
  scheduleReplyRetry(input: {
    id: string;
    leaseToken: string;
    nextAttemptAt: Date;
    reason: string;
    retriedAt: Date;
  }): Promise<void>;
};

export type WhatsAppOutboundReplyProvider = {
  send(
    input: Parameters<WhatsAppInboundReplySender["send"]>[0],
  ): Promise<WhatsAppSendResult>;
};

type WhatsAppOutboundError = Error & {
  ambiguous?: boolean;
  nextAttemptAt?: Date | null;
  retryable?: boolean;
};

export async function runWhatsAppOutboundReplyWorker(
  input: { limit?: number; now: Date },
  store: WhatsAppOutboundReplyStore,
  provider: WhatsAppOutboundReplyProvider,
  observer?: WhatsAppOperationalObserver,
) {
  const replies = await store.claimDueReplies({
    limit: input.limit ?? 50,
    now: input.now,
  });
  let accepted = 0;
  let failed = 0;
  let retried = 0;
  let unknown = 0;
  for (const reply of replies) {
    const startedAt = Date.now();
    const leaseToken = requireLeaseToken(reply);
    if (
      reply.serviceWindowExpiresAt !== undefined &&
      reply.serviceWindowExpiresAt !== null &&
      reply.serviceWindowExpiresAt <= input.now
    ) {
      await store.markFailedReply({
        id: reply.id,
        leaseToken,
        now: input.now,
        reason: "La Ventana de servicio de WhatsApp ya expiró",
      });
      failed += 1;
      continue;
    }
    let result: WhatsAppSendResult;
    try {
      result = await provider.send(reply);
    } catch (error) {
      const outboundError = toOutboundError(error);
      if (outboundError instanceof WhatsAppCircuitBreakerOpenError) {
        if (store.deferReplyForCircuit === undefined) {
          await store.scheduleReplyRetry({
            id: reply.id,
            leaseToken,
            nextAttemptAt: nextReplyAttemptAt(
              outboundError,
              input.now,
              reply.attempts,
            ),
            reason: outboundError.message,
            retriedAt: input.now,
          });
        } else {
          await store.deferReplyForCircuit({
            id: reply.id,
            leaseToken,
            now: input.now,
            reason: outboundError.message,
          });
        }
        retried += 1;
        continue;
      }
      try {
        await observeReply({
          error: outboundError,
          now: input.now,
          observer,
          outcome: outboundError.ambiguous === true ? "unknown" : "failed",
          reply,
          startedAt,
        });
      } catch (observationError) {
        if (
          observationError instanceof WhatsAppOperationalMetricPersistenceError
        ) {
          await store.scheduleReplyRetry({
            id: reply.id,
            leaseToken,
            nextAttemptAt: nextReplyAttemptAt(
              observationError,
              input.now,
              reply.attempts,
            ),
            reason: observationError.message,
            retriedAt: input.now,
          });
          retried += 1;
          continue;
        }
        throw observationError;
      }
      if (outboundError.ambiguous === true) {
        await store.markUnknownReply({
          id: reply.id,
          leaseToken,
          now: input.now,
          reason: outboundError.message,
        });
        unknown += 1;
      } else if (outboundError.retryable === false) {
        await store.markFailedReply({
          id: reply.id,
          leaseToken,
          now: input.now,
          reason: outboundError.message,
        });
        failed += 1;
      } else {
        await store.scheduleReplyRetry({
          id: reply.id,
          leaseToken,
          nextAttemptAt: nextReplyAttemptAt(
            outboundError,
            input.now,
            reply.attempts,
          ),
          reason: outboundError.message,
          retriedAt: input.now,
        });
        retried += 1;
      }
      continue;
    }

    try {
      await observeReply({
        now: input.now,
        observer,
        outcome: "accepted",
        reply,
        startedAt,
      });
      await store.markAcceptedReply({
        id: reply.id,
        leaseToken,
        now: input.now,
        providerMessageId: result.providerMessageId,
      });
      accepted += 1;
    } catch (error) {
      if (error instanceof WhatsAppOperationalMetricPersistenceError) {
        await store.scheduleReplyRetry({
          id: reply.id,
          leaseToken,
          nextAttemptAt: nextReplyAttemptAt(error, input.now, reply.attempts),
          reason: error.message,
          retriedAt: input.now,
        });
        retried += 1;
        continue;
      }
      // Kapso ya pudo enviar; reintentar por un fallo de persistencia duplicaría
      // la respuesta. Se deja en reconciliación por el callback del proveedor.
      await observeReply({
        error:
          error instanceof Error
            ? error
            : new Error("No se pudo persistir el resultado del proveedor"),
        now: input.now,
        observer,
        outcome: "unknown",
        reply,
        startedAt,
      });
      await store.markUnknownReply({
        id: reply.id,
        leaseToken,
        now: input.now,
        reason: `No se pudo persistir el resultado del proveedor: ${
          error instanceof Error ? error.message : "error desconocido"
        }`,
      });
      unknown += 1;
    }
  }
  return { accepted, claimed: replies.length, failed, retried, unknown };
}

function requireLeaseToken(reply: WhatsAppOutboundReply) {
  if (reply.leaseToken === null) {
    throw new Error("Falta la concesión de la respuesta de WhatsApp");
  }
  return reply.leaseToken;
}

function replyRetryDelay(attempts: number) {
  return Math.min(15 * 60_000, 10_000 * 2 ** Math.max(0, attempts - 1));
}

function nextReplyAttemptAt(
  error: WhatsAppOutboundError,
  now: Date,
  attempts: number,
) {
  return error.nextAttemptAt !== undefined &&
    error.nextAttemptAt !== null &&
    error.nextAttemptAt > now
    ? error.nextAttemptAt
    : new Date(now.valueOf() + replyRetryDelay(attempts));
}

function toOutboundError(error: unknown): WhatsAppOutboundError {
  if (error instanceof Error) {
    return error;
  }
  return new Error("No se pudo enviar la respuesta de WhatsApp");
}

async function observeReply(input: {
  error?: Error;
  now: Date;
  observer?: WhatsAppOperationalObserver;
  outcome: "accepted" | "failed" | "unknown";
  reply: WhatsAppOutboundReply;
  startedAt: number;
}) {
  if (input.observer === undefined) return;
  const errorCode = input.error?.name ?? null;
  await persistWhatsAppOperationalMetric(input.observer, {
    clinicId: input.reply.clinicId,
    errorCode,
    idempotencyKey: `reply:${input.reply.idempotencyKey}:${input.reply.attempts}:${input.outcome}`,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    metric: {
      category:
        input.reply.buttonLabel === undefined ? "message" : "interactive",
      direction: "outbound",
    },
    occurredAt: input.now,
    operation: "inbound-reply",
    outcome: input.outcome,
    workerKind: "outbound",
  });
  if (input.error !== undefined && input.outcome !== "accepted") {
    await input.observer.recordFailure({
      cause: "high-failure-rate",
      clinicId: input.reply.clinicId,
      now: input.now,
      reason: input.error.message,
      workerKind: "outbound",
    });
  }
}
