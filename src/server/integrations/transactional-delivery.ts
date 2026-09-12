import { createDailyAgendaPdf } from "~/server/application/appointment-reminders";
import type { TransactionalDeliverySender } from "~/server/application/transactional-deliveries";
import {
  chooseTransactionalWhatsAppRoute,
  WhatsAppUtilityTemplateRequiredError,
} from "~/domain/whatsapp-delivery";
import type {
  TransactionalWhatsAppRoute,
  TransactionalWhatsAppTemplate,
} from "~/domain/whatsapp-delivery";
import type { WhatsAppProvider } from "~/server/application/whatsapp-provider";
import { sendSimulatedDailyAgenda } from "~/server/email/simulated-identity-email";
import { whatsAppProviderAdapter } from "~/server/whatsapp/whatsapp-delivery";

const emptyTransactionalWhatsAppTemplate: TransactionalWhatsAppTemplate = {
  category: null,
  locale: "",
  name: "",
  parameters: [],
  providerTemplateId: null,
  status: null,
};

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
    template?: TransactionalWhatsAppTemplate;
    text?: string;
  },
  now: Date,
) {
  if (payload.text === undefined) {
    const serviceWindowIsOpen =
      payload.serviceWindowExpiresAt !== undefined &&
      payload.serviceWindowExpiresAt !== null &&
      payload.serviceWindowExpiresAt > now;

    if (payload.route?.kind === "template") {
      validatePersistedTemplateRoute(payload, now);
      return payload.route;
    }
    if (serviceWindowIsOpen) {
      return payload.route;
    }
    throw new WhatsAppUtilityTemplateRequiredError();
  }
  return chooseTransactionalWhatsAppRoute({
    now,
    serviceWindowExpiresAt: payload.serviceWindowExpiresAt ?? null,
    template: payload.template ?? emptyTransactionalWhatsAppTemplate,
    text: payload.text,
  });
}

function validatePersistedTemplateRoute(
  payload: {
    route?: TransactionalWhatsAppRoute;
    template?: TransactionalWhatsAppTemplate;
  },
  now: Date,
) {
  const route = payload.route;
  if (route?.kind !== "template") {
    throw new WhatsAppUtilityTemplateRequiredError();
  }
  const validated = chooseTransactionalWhatsAppRoute({
    now,
    serviceWindowExpiresAt: null,
    template: payload.template ?? emptyTransactionalWhatsAppTemplate,
    text: "",
  });
  if (validated.kind !== "template") {
    throw new WhatsAppUtilityTemplateRequiredError();
  }
  if (
    validated.locale !== route.locale ||
    validated.name !== route.name ||
    validated.providerTemplateId !== route.providerTemplateId ||
    validated.parameters.length !== route.parameters.length ||
    validated.parameters.some(
      (parameter, index) => parameter !== route.parameters[index],
    )
  ) {
    throw new WhatsAppUtilityTemplateRequiredError();
  }
}
