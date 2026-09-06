import "server-only";

import { PHASE_PRODUCTION_BUILD } from "next/constants";

import type { WhatsAppProviderId } from "~/domain/whatsapp-runtime";
import { assertWhatsAppRuntimeReady } from "~/domain/whatsapp-runtime";
import type { WhatsAppProvider } from "~/server/application/whatsapp-provider";
import { env } from "~/env";
import { requireWhatsAppConnectionReady } from "~/server/db/whatsapp-connection-store";
import {
  sendSimulatedConversationEscalationNotification,
  sendSimulatedConversationReply,
  simulatedAppointmentMessageSender,
  simulatedAppointmentReminderSender,
} from "./simulated-appointment-messages";
import { createKapsoWhatsAppSenders } from "./kapso-whatsapp";

export type WhatsAppSenderBundle = WhatsAppProvider;

/** Kapso exige sus dos secretos de proyecto; el modo simulado no exige ninguno. */
export function assertWhatsAppDeliveryAllowed() {
  assertWhatsAppRuntimeReady({
    kapsoApiKey: env.KAPSO_API_KEY,
    provider: env.WHATSAPP_DELIVERY,
    webhookSecret: env.KAPSO_WEBHOOK_SECRET,
  });
}

if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) {
  assertWhatsAppDeliveryAllowed();
}

const simulatedBundle: WhatsAppSenderBundle = {
  appointmentMessageSender: {
    async send(input) {
      await requireWhatsAppConnectionReady({
        clinicId: input.clinicId,
        provider: "simulated",
      });
      await simulatedAppointmentMessageSender.send(input);
    },
  },
  appointmentReminderSender: {
    async send(input) {
      await requireWhatsAppConnectionReady({
        clinicId: input.clinicId,
        provider: "simulated",
      });
      await simulatedAppointmentReminderSender.send(input);
    },
  },
  provider: "simulated",
  sendConversationReply: async (input) => {
    await requireWhatsAppConnectionReady({
      clinicId: input.clinicId,
      provider: "simulated",
    });
    await sendSimulatedConversationReply(input);
  },
  sendConversationEscalationNotification: async (input) => {
    await requireWhatsAppConnectionReady({
      clinicId: input.clinicId,
      provider: "simulated",
    });
    await sendSimulatedConversationEscalationNotification(input);
  },
};

let kapsoCache: WhatsAppSenderBundle | undefined;

/**
 * Selección por configuración de los adaptadores de WhatsApp. Kapso nunca
 * cae silenciosamente al adaptador simulado si todavía falta la Conexión de
 * WhatsApp propia de una Clínica.
 */
export function whatsAppProviderAdapter(): WhatsAppProvider {
  if (env.WHATSAPP_DELIVERY === "simulated") return simulatedBundle;
  if (kapsoCache === undefined) {
    const senders = createKapsoWhatsAppSenders();
    kapsoCache = {
      appointmentMessageSender: senders.appointmentMessageSender,
      appointmentReminderSender: senders.appointmentReminderSender,
      provider: "kapso",
      sendConversationReply: (input) => senders.sendConversationReply(input),
      sendConversationEscalationNotification: (input) =>
        senders.sendConversationEscalationNotification(input),
    };
  }
  return kapsoCache;
}

/** Nombre histórico para consumidores que todavía solicitan el bundle. */
export function whatsAppSender(): WhatsAppSenderBundle {
  return whatsAppProviderAdapter();
}

/** Proveedor activo sin exponer la configuración sensible del entorno. */
export function whatsAppProvider(): WhatsAppProviderId {
  return env.WHATSAPP_DELIVERY;
}
