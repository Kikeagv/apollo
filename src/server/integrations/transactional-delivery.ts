import { createDailyAgendaPdf } from "~/server/application/appointment-reminders";
import type { TransactionalDeliverySender } from "~/server/application/transactional-deliveries";
import { sendSimulatedDailyAgenda } from "~/server/email/simulated-identity-email";
import { whatsAppSender } from "~/server/whatsapp/whatsapp-delivery";

/** Selecciona los adaptadores del outbox sin alterar el caso de uso. */
export function transactionalDeliveryAdapter(): TransactionalDeliverySender {
  const appointmentReminderSender = whatsAppSender().appointmentReminderSender;
  return {
    async send(delivery) {
      if (delivery.kind === "appointment-reminder") {
        await appointmentReminderSender.send({
          appointmentId: delivery.payload.appointmentId,
          clinicId: delivery.clinicId,
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
}
