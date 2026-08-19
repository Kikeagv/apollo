import "server-only";

import type { AppointmentReminderSender } from "~/server/application/appointment-reminders";
import type { ConversationEscalationTrigger } from "~/server/application/conversation-escalations";
import type { ManualAppointmentMessageSender } from "~/server/application/manual-appointments";
import { env } from "~/env";
import {
  sendSimulatedConversationEscalationNotification,
  simulatedAppointmentMessageSender,
  simulatedAppointmentReminderSender,
} from "./simulated-appointment-messages";
import { createTwilioWhatsAppSenders } from "./twilio-whatsapp";

export type WhatsAppSenderBundle = {
  appointmentMessageSender: ManualAppointmentMessageSender;
  appointmentReminderSender: AppointmentReminderSender;
  sendConversationEscalationNotification(input: {
    clinicId: string;
    escalationId: string;
    recipientPhoneE164: string;
    trigger: ConversationEscalationTrigger;
  }): Promise<void>;
};

/** WhatsApp real exige secretos de Twilio; el modo simulado es para dev/test. */
export function assertWhatsAppDeliveryAllowed() {
  if (
    env.WHATSAPP_DELIVERY === "twilio" &&
    (env.TWILIO_ACCOUNT_SID === undefined ||
      env.TWILIO_AUTH_TOKEN === undefined ||
      env.TWILIO_WHATSAPP_FROM === undefined)
  ) {
    throw new Error(
      "WHATSAPP_DELIVERY=twilio requiere TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_WHATSAPP_FROM",
    );
  }
}

assertWhatsAppDeliveryAllowed();

const simulatedBundle: WhatsAppSenderBundle = {
  appointmentMessageSender: simulatedAppointmentMessageSender,
  appointmentReminderSender: simulatedAppointmentReminderSender,
  sendConversationEscalationNotification:
    sendSimulatedConversationEscalationNotification,
};

let twilioCache: WhatsAppSenderBundle | undefined;

/**
 * Selección por configuración de los adaptadores de WhatsApp. El piloto
 * mantiene los simulados; activar Twilio sustituye esta selección, no el caso
 * de uso de Agenda ni el diálogo de Asclepio.
 */
export function whatsAppSender(): WhatsAppSenderBundle {
  if (env.WHATSAPP_DELIVERY !== "twilio") return simulatedBundle;
  if (twilioCache === undefined) {
    const senders = createTwilioWhatsAppSenders();
    twilioCache = {
      appointmentMessageSender: senders.appointmentMessageSender,
      appointmentReminderSender: senders.appointmentReminderSender,
      sendConversationEscalationNotification: (input) =>
        senders.sendConversationEscalationNotification(input),
    };
  }
  return twilioCache;
}
