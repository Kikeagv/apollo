import type {
  AppointmentReminderCheckpoint,
  AppointmentReminderRecipient,
} from "./appointment-reminders";
import type { ManualAppointmentMessageType } from "./manual-appointments";
import type { TransactionalWhatsAppRoute } from "~/domain/whatsapp-delivery";
import type { WhatsAppUsageMetric } from "~/domain/whatsapp-circuit-breaker";
import {
  persistWhatsAppOperationalMetric,
  WhatsAppOperationalMetricPersistenceError,
  type WhatsAppOperationalObserver,
} from "./whatsapp-circuit-breaker";
import { WhatsAppCircuitBreakerOpenError } from "./whatsapp-provider";

export type TransactionalDelivery =
  | {
      attempts: number;
      clinicId: string;
      id: string;
      idempotencyKey: string;
      kind: "appointment-reminder";
      payload: {
        appointmentId: string;
        appointmentStartsAt: Date;
        checkpoint: AppointmentReminderCheckpoint;
        clinicName: string;
        doctorName?: string | null;
        patientName?: string | null;
        recipientBusinessScopedUserId?: string | null;
        recipient: AppointmentReminderRecipient;
        route?: TransactionalWhatsAppRoute;
        serviceWindowExpiresAt?: Date | null;
        template?: {
          category?: string | null;
          locale: string;
          name: string;
          parameters: string[];
          providerTemplateId: string | null;
          status?: string | null;
        };
        text?: string;
      };
    }
  | {
      attempts: number;
      clinicId: string;
      id: string;
      idempotencyKey: string;
      kind: "daily-agenda-pdf";
      payload: {
        agenda: Array<{ patientName: string; startsAt: Date }>;
        clinicName: string;
        doctorName: string;
        recipientEmail: string;
      };
    }
  | {
      attempts: number;
      clinicId: string;
      id: string;
      idempotencyKey: string;
      kind: "appointment-message";
      payload: {
        appointmentId: string;
        doctorName?: string | null;
        patientName?: string | null;
        recipientBusinessScopedUserId?: string | null;
        recipient: AppointmentReminderRecipient;
        route?: TransactionalWhatsAppRoute;
        serviceWindowExpiresAt?: Date | null;
        template?: {
          category?: string | null;
          locale: string;
          name: string;
          parameters: string[];
          providerTemplateId: string | null;
          status?: string | null;
        };
        text?: string;
        type: ManualAppointmentMessageType;
      };
    };

export type TransactionalDeliveryError = Error & {
  ambiguous?: boolean;
  nextAttemptAt?: Date | null;
  retryable?: boolean;
};

export type TransactionalDeliveryStore = {
  claimReadyDeliveries(input: { now: Date }): Promise<TransactionalDelivery[]>;
  markAccepted?(input: {
    delivery: TransactionalDelivery;
    now: Date;
    providerMessageId: string;
  }): Promise<void>;
  markFailed?(input: {
    delivery: TransactionalDelivery;
    error: Error;
    now: Date;
  }): Promise<void>;
  markDelivered(input: {
    delivery: TransactionalDelivery;
    now: Date;
  }): Promise<void>;
  markUnknown?(input: {
    delivery: TransactionalDelivery;
    error: Error;
    now: Date;
  }): Promise<void>;
  deferForCircuit?(input: {
    delivery: TransactionalDelivery;
    error: Error;
    now: Date;
  }): Promise<void>;
  scheduleRetry(input: {
    delivery: TransactionalDelivery;
    error: TransactionalDeliveryError;
    now: Date;
  }): Promise<void>;
};

export type TransactionalDeliverySendResult = {
  providerMessageId: string;
  status: "accepted";
};

export type TransactionalDeliverySender = {
  send(
    delivery: TransactionalDelivery,
    context?: { now: Date },
  ): Promise<TransactionalDeliverySendResult | void>;
};

export type TransactionalDeliveryCallbackStore = {
  recordProviderCallback(input: {
    idempotencyKey?: string | null;
    phoneNumberId?: string | null;
    providerMessageId?: string | null;
    providerEventId?: string | null;
    error?: string | null;
    status: "accepted" | "sent" | "delivered" | "read" | "failed";
  }): Promise<TransactionalDeliveryCallbackObservation | void>;
};

export type TransactionalDeliveryCallbackObservation = {
  clinicId: string;
  errorCode: string | null;
  idempotencyKey: string;
  isNew?: boolean;
  metric: WhatsAppUsageMetric;
  operation: "inbound-reply" | "transactional-delivery-status";
  outcome: "delivered" | "failed" | "read" | "unknown";
  templateName: string | null;
};

export type TransactionalDeliverySchedulerStore = {
  applyNoShowPolicy(input: { now: Date }): Promise<{
    alerted: number;
    cancelled: number;
  }>;
  enqueueDueDeliveries(input: { now: Date }): Promise<{
    agendas: number;
    reminders: number;
  }>;
  purgeExpiredDeliveries(input: { now: Date }): Promise<number>;
  releaseExpiredReservations(input: { now: Date }): Promise<number>;
};

/**
 * Entrega el outbox con semántica al-menos-una-vez. La persistencia concede
 * diez minutos y conserva la clave que el adaptador usa para deduplicar.
 */
export async function runTransactionalDeliveryWorker(
  input: { now: Date },
  store: TransactionalDeliveryStore,
  sender: TransactionalDeliverySender,
  observer?: WhatsAppOperationalObserver,
) {
  const deliveries = await store.claimReadyDeliveries(input);
  let delivered = 0;
  let accepted = 0;
  let failed = 0;
  let unknown = 0;
  let retried = 0;
  for (const delivery of deliveries) {
    const startedAt = Date.now();
    let result: TransactionalDeliverySendResult | void;
    try {
      result = await sender.send(delivery, input);
    } catch (error) {
      const deliveryError = toTransactionalDeliveryError(error);
      if (deliveryError instanceof WhatsAppCircuitBreakerOpenError) {
        if (store.deferForCircuit === undefined) {
          await store.scheduleRetry({
            delivery,
            error: deliveryError,
            now: input.now,
          });
        } else {
          await store.deferForCircuit({
            delivery,
            error: deliveryError,
            now: input.now,
          });
        }
        retried += 1;
        continue;
      }
      if (deliveryError.ambiguous === true) {
        try {
          await observeTransactionalDelivery({
            delivery,
            error: deliveryError,
            now: input.now,
            observer,
            outcome: "unknown",
            startedAt,
          });
        } catch (observationError) {
          if (
            observationError instanceof
            WhatsAppOperationalMetricPersistenceError
          ) {
            await store.scheduleRetry({
              delivery,
              error: observationError,
              now: input.now,
            });
            retried += 1;
            continue;
          }
          throw observationError;
        }
        if (store.markUnknown !== undefined) {
          await store.markUnknown({
            delivery,
            error: deliveryError,
            now: input.now,
          });
        } else {
          await store.scheduleRetry({
            delivery,
            error: deliveryError,
            now: input.now,
          });
        }
        unknown += 1;
        continue;
      }
      if (deliveryError.retryable === false && store.markFailed !== undefined) {
        try {
          await observeTransactionalDelivery({
            delivery,
            error: deliveryError,
            now: input.now,
            observer,
            outcome: "failed",
            startedAt,
          });
        } catch (observationError) {
          if (
            observationError instanceof
            WhatsAppOperationalMetricPersistenceError
          ) {
            await store.scheduleRetry({
              delivery,
              error: observationError,
              now: input.now,
            });
            retried += 1;
            continue;
          }
          throw observationError;
        }
        await store.markFailed({
          delivery,
          error: deliveryError,
          now: input.now,
        });
        failed += 1;
        continue;
      }
      try {
        await observeTransactionalDelivery({
          delivery,
          error: deliveryError,
          now: input.now,
          observer,
          outcome: "failed",
          startedAt,
        });
      } catch (observationError) {
        if (
          observationError instanceof WhatsAppOperationalMetricPersistenceError
        ) {
          await store.scheduleRetry({
            delivery,
            error: observationError,
            now: input.now,
          });
          retried += 1;
          continue;
        }
        throw observationError;
      }
      await store.scheduleRetry({
        delivery,
        error: deliveryError,
        now: input.now,
      });
      retried += 1;
      continue;
    }

    try {
      if (result?.status === "accepted" && store.markAccepted !== undefined) {
        await observeTransactionalDelivery({
          delivery,
          now: input.now,
          observer,
          outcome: "accepted",
          startedAt,
        });
        await store.markAccepted({
          delivery,
          now: input.now,
          providerMessageId: result.providerMessageId,
        });
        accepted += 1;
      } else {
        await observeTransactionalDelivery({
          delivery,
          now: input.now,
          observer,
          outcome: "delivered",
          startedAt,
        });
        await store.markDelivered({ delivery, now: input.now });
        delivered += 1;
      }
    } catch (error) {
      if (error instanceof WhatsAppOperationalMetricPersistenceError) {
        await store.scheduleRetry({
          delivery,
          error,
          now: input.now,
        });
        retried += 1;
        continue;
      }
      // El proveedor ya tuvo efecto; un fallo al persistirlo no es seguro para
      // reintentar. La Entrega queda en reconciliación por callback/operación.
      if (store.markUnknown === undefined) throw error;
      await observeTransactionalDelivery({
        delivery,
        error:
          error instanceof Error
            ? error
            : new Error("No se pudo persistir el resultado del proveedor"),
        now: input.now,
        observer,
        outcome: "unknown",
        startedAt,
      });
      await store.markUnknown({
        delivery,
        error: new Error(
          `No se pudo persistir el resultado del proveedor: ${
            error instanceof Error ? error.message : "error desconocido"
          }`,
        ),
        now: input.now,
      });
      unknown += 1;
    }
  }
  return {
    accepted,
    claimed: deliveries.length,
    delivered,
    failed,
    retried,
    unknown,
  };
}

/** Ejecuta mantenimiento, preparación durable, entrega y política de silencio. */
export async function runTransactionalDeliveryScheduler(
  input: { now: Date },
  schedulerStore: TransactionalDeliverySchedulerStore,
  deliveryStore: TransactionalDeliveryStore,
  sender: TransactionalDeliverySender,
  observer?: WhatsAppOperationalObserver,
) {
  const releasedReservations =
    await schedulerStore.releaseExpiredReservations(input);
  const purgedDeliveries = await schedulerStore.purgeExpiredDeliveries(input);
  const enqueued = await schedulerStore.enqueueDueDeliveries(input);
  const deliveries = await runTransactionalDeliveryWorker(
    input,
    deliveryStore,
    sender,
    observer,
  );
  const silence = await schedulerStore.applyNoShowPolicy(input);
  return {
    ...deliveries,
    ...enqueued,
    ...silence,
    purgedDeliveries,
    releasedReservations,
  };
}

export function retryAt(attempts: number, now: Date) {
  const delays = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
  const delay = delays[attempts - 1];
  return delay === undefined ? undefined : new Date(now.valueOf() + delay);
}

/** Registra una sola respuesta del proveedor para una clave lógica de Entrega. */
export function captureTransactionalDeliveryCallback(
  input: {
    idempotencyKey?: string | null;
    phoneNumberId?: string | null;
    providerMessageId?: string | null;
    providerEventId?: string | null;
    error?: string | null;
    status: "accepted" | "sent" | "delivered" | "read" | "failed";
  },
  store: TransactionalDeliveryCallbackStore,
) {
  return store.recordProviderCallback(input);
}

function toTransactionalDeliveryError(
  error: unknown,
): TransactionalDeliveryError {
  if (error instanceof Error) return error;
  return new Error("Entrega fallida");
}

async function observeTransactionalDelivery(input: {
  delivery: TransactionalDelivery;
  error?: Error;
  now: Date;
  observer?: WhatsAppOperationalObserver;
  outcome: "accepted" | "delivered" | "failed" | "unknown";
  startedAt: number;
}) {
  if (
    input.observer === undefined ||
    input.delivery.kind === "daily-agenda-pdf"
  ) {
    return;
  }
  const metric = metricForDelivery(input.delivery);
  await persistWhatsAppOperationalMetric(input.observer, {
    clinicId: input.delivery.clinicId,
    errorCode: input.error?.name ?? null,
    idempotencyKey: `delivery:${input.delivery.idempotencyKey}:${input.delivery.attempts}:${input.outcome}`,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    metric,
    occurredAt: input.now,
    operation: "transactional-delivery",
    outcome: input.outcome,
    templateName: input.delivery.payload.template?.name ?? null,
    workerKind: "outbound",
  });
  if (
    input.error !== undefined &&
    (input.outcome === "failed" || input.outcome === "unknown")
  ) {
    await input.observer.recordFailure({
      cause: "high-failure-rate",
      clinicId: input.delivery.clinicId,
      now: input.now,
      reason: input.error.message,
      workerKind: "outbound",
    });
  }
}

function metricForDelivery(
  delivery: TransactionalDelivery,
): WhatsAppUsageMetric {
  if (delivery.kind === "daily-agenda-pdf") {
    return { category: "message", direction: "outbound" };
  }
  const route = delivery.payload.route;
  return {
    category:
      route?.kind === "template"
        ? "template"
        : route?.kind === "interactive"
          ? "interactive"
          : "message",
    direction: "outbound",
  };
}
