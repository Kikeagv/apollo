import "server-only";

import { PHASE_PRODUCTION_BUILD } from "next/constants";

import type { WhatsAppProviderId } from "~/domain/whatsapp-runtime";
import { assertWhatsAppRuntimeReady } from "~/domain/whatsapp-runtime";
import type { AppointmentReminderSender } from "~/server/application/appointment-reminders";
import type { ConversationEscalationTrigger } from "~/server/application/conversation-escalations";
import type { ManualAppointmentMessageSender } from "~/server/application/manual-appointments";
import { env } from "~/env";
import {
  sendSimulatedConversationEscalationNotification,
  simulatedAppointmentMessageSender,
  simulatedAppointmentReminderSender,
} from "./simulated-appointment-messages";
import { createKapsoWhatsAppSenders } from "./kapso-whatsapp";

export type WhatsAppSenderBundle = {
  appointmentMessageSender: ManualAppointmentMessageSender;
  appointmentReminderSender: AppointmentReminderSender;
  provider: WhatsAppProviderId;
  sendConversationEscalationNotification(input: {
    clinicId: string;
    escalationId: string;
    recipientPhoneE164: string;
    trigger: ConversationEscalationTrigger;
  }): Promise<void>;
};

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
  appointmentMessageSender: simulatedAppointmentMessageSender,
  appointmentReminderSender: simulatedAppointmentReminderSender,
  provider: "simulated",
  sendConversationEscalationNotification:
    sendSimulatedConversationEscalationNotification,
};

let kapsoCache: WhatsAppSenderBundle | undefined;

/**
 * Selección por configuración de los adaptadores de WhatsApp. Kapso nunca
 * cae silenciosamente al adaptador simulado si todavía falta la Conexión de
 * WhatsApp propia de una Clínica.
 */
export function whatsAppSender(): WhatsAppSenderBundle {
  if (env.WHATSAPP_DELIVERY === "simulated") return simulatedBundle;
  if (kapsoCache === undefined) {
    const senders = createKapsoWhatsAppSenders();
    kapsoCache = {
      appointmentMessageSender: senders.appointmentMessageSender,
      appointmentReminderSender: senders.appointmentReminderSender,
      provider: "kapso",
      sendConversationEscalationNotification: (input) =>
        senders.sendConversationEscalationNotification(input),
    };
  }
  return kapsoCache;
}

/** Proveedor activo sin exponer la configuración sensible del entorno. */
export function whatsAppProvider(): WhatsAppProviderId {
  return env.WHATSAPP_DELIVERY;
}
