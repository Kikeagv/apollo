import { createDailyAgendaPdf } from "~/server/application/appointment-reminders";
import type { TransactionalDeliverySender } from "~/server/application/transactional-deliveries";
import { env } from "~/env";
import { sendSimulatedDailyAgenda } from "~/server/email/simulated-identity-email";
import { sendSimulatedAppointmentReminder } from "~/server/whatsapp/simulated-appointment-messages";

/** Selecciona los adaptadores del outbox sin alterar el caso de uso. */
export function transactionalDeliveryAdapter(): TransactionalDeliverySender {
  const adapters = {
    simulated: simulatedTransactionalDeliverySender,
  } satisfies Record<
    typeof env.APPOINTMENT_SCHEDULER_DELIVERY,
    TransactionalDeliverySender
  >;
  return adapters[env.APPOINTMENT_SCHEDULER_DELIVERY];
}

const simulatedTransactionalDeliverySender: TransactionalDeliverySender = {
  async send(delivery) {
    if (delivery.kind === "appointment-reminder") {
      await sendSimulatedAppointmentReminder({
        appointmentId: delivery.payload.appointmentId,
        clinicId: delivery.clinicId,
        idempotencyKey: delivery.idempotencyKey,
        recipient: delivery.payload.recipient,
      });
      return;
    }
    await sendSimulatedDailyAgenda({
      ...delivery.payload,
      idempotencyKey: delivery.idempotencyKey,
      pdf: createDailyAgendaPdf(delivery.payload),
    });
  },
};
