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

/** Puerto único de salida de WhatsApp para los casos de uso de Praxia. */
export type WhatsAppProvider = {
  appointmentMessageSender: ManualAppointmentMessageSender;
  appointmentReminderSender: AppointmentReminderSender;
  provider: WhatsAppProviderId;
  sendConversationReply(input: {
    clinicId: string;
    idempotencyKey: string;
    recipientPhoneE164: string;
    text: string;
  }): Promise<void>;
  sendConversationEscalationNotification(input: {
    clinicId: string;
    escalationId: string;
    recipientPhoneE164: string;
    trigger: ConversationEscalationTrigger;
  }): Promise<void>;
};
