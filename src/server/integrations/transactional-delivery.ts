import { createDailyAgendaPdf } from "~/server/application/appointment-reminders";
import type { TransactionalDeliverySender } from "~/server/application/transactional-deliveries";
import { chooseTransactionalWhatsAppRoute } from "~/domain/whatsapp-delivery";
import type { TransactionalWhatsAppRoute } from "~/domain/whatsapp-delivery";
import type { WhatsAppProvider } from "~/server/application/whatsapp-provider";
import { sendSimulatedDailyAgenda } from "~/server/email/simulated-identity-email";
import { whatsAppProviderAdapter } from "~/server/whatsapp/whatsapp-delivery";

/** Selecciona los adaptadores del outbox sin alterar el caso de uso. */
export function transactionalDeliveryAdapter(
  provider: WhatsAppProvider = whatsAppProviderAdapter(),
): TransactionalDeliverySender {
  const appointmentReminderSender = provider.appointmentReminderSender;
  return {
    async send(delivery, context = { now: new Date() }) {
      if (delivery.kind === "appointment-reminder") {
        const route = routeForDelivery(delivery.payload, context.now);
        const result = await appointmentReminderSender.send({
          appointmentId: delivery.payload.appointmentId,
          clinicId: delivery.clinicId,
          idempotencyKey: delivery.idempotencyKey,
          recipient: delivery.payload.recipient,
          ...(delivery.payload.recipientBusinessScopedUserId === undefined
            ? {}
            : {
                recipientBusinessScopedUserId:
                  delivery.payload.recipientBusinessScopedUserId,
              }),
          ...(route === undefined ? {} : { route }),
        });
        return result;
      }
      if (delivery.kind === "appointment-message") {
        const route = routeForDelivery(delivery.payload, context.now);
        const result = await provider.appointmentMessageSender.send({
          appointmentId: delivery.payload.appointmentId,
          clinicId: delivery.clinicId,
          idempotencyKey: delivery.idempotencyKey,
          recipient: delivery.payload.recipient,
          type: delivery.payload.type,
          ...(delivery.payload.recipientBusinessScopedUserId === undefined
            ? {}
            : {
                recipientBusinessScopedUserId:
                  delivery.payload.recipientBusinessScopedUserId,
              }),
          ...(route === undefined ? {} : { route }),
        });
        return result;
      }
      await sendSimulatedDailyAgenda({
        ...delivery.payload,
        idempotencyKey: delivery.idempotencyKey,
        pdf: createDailyAgendaPdf(delivery.payload),
      });
    },
  };
}

function routeForDelivery(
  payload: {
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
  },
  now: Date,
) {
  if (payload.text === undefined) return payload.route;
  return chooseTransactionalWhatsAppRoute({
    now,
    serviceWindowExpiresAt: payload.serviceWindowExpiresAt ?? null,
    template: payload.template ?? {
      category: null,
      locale: "",
      name: "",
      parameters: [],
      providerTemplateId: null,
      status: null,
    },
    text: payload.text,
  });
}
