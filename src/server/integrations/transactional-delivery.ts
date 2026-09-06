import { createDailyAgendaPdf } from "~/server/application/appointment-reminders";
import type { TransactionalDeliverySender } from "~/server/application/transactional-deliveries";
import type { WhatsAppProvider } from "~/server/application/whatsapp-provider";
import { sendSimulatedDailyAgenda } from "~/server/email/simulated-identity-email";
import { whatsAppProviderAdapter } from "~/server/whatsapp/whatsapp-delivery";

/** Selecciona los adaptadores del outbox sin alterar el caso de uso. */
export function transactionalDeliveryAdapter(
  provider: WhatsAppProvider = whatsAppProviderAdapter(),
): TransactionalDeliverySender {
  const appointmentReminderSender = provider.appointmentReminderSender;
  return {
    async send(delivery) {
      if (delivery.kind === "appointment-reminder") {
        await appointmentReminderSender.send({
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
}
