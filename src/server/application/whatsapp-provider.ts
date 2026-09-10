import type { WhatsAppProviderId } from "~/domain/whatsapp-runtime";
import type { AppointmentReminderSender } from "./appointment-reminders";
import type { ConversationEscalationTrigger } from "./conversation-escalations";
import type { ManualAppointmentMessageSender } from "./manual-appointments";

export class WhatsAppConnectionRequiredError extends Error {
  constructor() {
    super("La Clínica no tiene una Conexión de WhatsApp lista para enviar");
    this.name = "WhatsAppConnectionRequiredError";
  }
}

export type WhatsAppSendResult = {
  providerMessageId: string;
  status: "accepted";
};

/** Puerto único de salida de WhatsApp para los casos de uso de Praxia. */
export type WhatsAppProvider = {
  appointmentMessageSender: ManualAppointmentMessageSender;
  appointmentReminderSender: AppointmentReminderSender;
  provider: WhatsAppProviderId;
  sendConversationReply(input: {
    buttonLabel?: string;
    clinicId: string;
    idempotencyKey: string;
    recipientBusinessScopedUserId?: string | null;
    recipientPhoneE164: string | null;
    text: string;
  }): Promise<WhatsAppSendResult | void>;
  sendConversationEscalationNotification(input: {
    clinicId: string;
    escalationId: string;
    recipientPhoneE164: string;
    trigger: ConversationEscalationTrigger;
  }): Promise<WhatsAppSendResult | void>;
};
