import type {
  AppointmentReminderCheckpoint,
  AppointmentReminderRecipient,
} from "./appointment-reminders";

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
        recipient: AppointmentReminderRecipient;
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
    };

export type TransactionalDeliveryStore = {
  claimReadyDeliveries(input: { now: Date }): Promise<TransactionalDelivery[]>;
  markDelivered(input: {
    delivery: TransactionalDelivery;
    now: Date;
  }): Promise<void>;
  scheduleRetry(input: {
    delivery: TransactionalDelivery;
    error: Error;
    now: Date;
  }): Promise<void>;
};

export type TransactionalDeliverySender = {
  send(delivery: TransactionalDelivery): Promise<void>;
};

export type TransactionalDeliveryCallbackStore = {
  recordProviderCallback(input: {
    idempotencyKey: string;
    status: "delivered" | "failed";
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
  let retried = 0;
  for (const delivery of deliveries) {
    try {
      await sender.send(delivery);
      await store.markDelivered({ delivery, now: input.now });
      delivered += 1;
    } catch (error) {
      await store.scheduleRetry({
        delivery,
        error: error instanceof Error ? error : new Error("Entrega fallida"),
        now: input.now,
      });
      retried += 1;
    }
  }
  return { claimed: deliveries.length, delivered, retried };
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
  input: { idempotencyKey: string; status: "delivered" | "failed" },
  store: TransactionalDeliveryCallbackStore,
) {
  return store.recordProviderCallback(input);
}
