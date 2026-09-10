import type {
  AppointmentReminderCheckpoint,
  AppointmentReminderRecipient,
} from "./appointment-reminders";
import type { ManualAppointmentMessageType } from "./manual-appointments";
import type { TransactionalWhatsAppRoute } from "~/domain/whatsapp-delivery";

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
  }): Promise<void>;
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
) {
  const deliveries = await store.claimReadyDeliveries(input);
  let delivered = 0;
  let accepted = 0;
  let unknown = 0;
  let retried = 0;
  for (const delivery of deliveries) {
    let result: TransactionalDeliverySendResult | void;
    try {
      result = await sender.send(delivery, input);
    } catch (error) {
      const deliveryError = toTransactionalDeliveryError(error);
      if (deliveryError.ambiguous === true) {
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
        await store.markFailed({
          delivery,
          error: deliveryError,
          now: input.now,
        });
        retried += 1;
        continue;
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
        await store.markAccepted({
          delivery,
          now: input.now,
          providerMessageId: result.providerMessageId,
        });
        accepted += 1;
      } else {
        await store.markDelivered({ delivery, now: input.now });
        delivered += 1;
      }
    } catch (error) {
      // El proveedor ya tuvo efecto; un fallo al persistirlo no es seguro para
      // reintentar. La Entrega queda en reconciliación por callback/operación.
      if (store.markUnknown === undefined) throw error;
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
  return { accepted, claimed: deliveries.length, delivered, retried, unknown };
}

/** Ejecuta mantenimiento, preparación durable, entrega y política de silencio. */
export async function runTransactionalDeliveryScheduler(
  input: { now: Date },
  schedulerStore: TransactionalDeliverySchedulerStore,
  deliveryStore: TransactionalDeliveryStore,
  sender: TransactionalDeliverySender,
) {
  const releasedReservations =
    await schedulerStore.releaseExpiredReservations(input);
  const purgedDeliveries = await schedulerStore.purgeExpiredDeliveries(input);
  const enqueued = await schedulerStore.enqueueDueDeliveries(input);
  const deliveries = await runTransactionalDeliveryWorker(
    input,
    deliveryStore,
    sender,
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
