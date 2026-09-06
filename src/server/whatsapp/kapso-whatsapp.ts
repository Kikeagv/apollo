import "server-only";

import type { AppointmentReminderSender } from "~/server/application/appointment-reminders";
import type { ConversationEscalationTrigger } from "~/server/application/conversation-escalations";
import type { ManualAppointmentMessageSender } from "~/server/application/manual-appointments";

/**
 * El runtime puede seleccionar Kapso antes de que exista una Conexión de
 * WhatsApp por Clínica. Este adaptador falla cerrado para no enviar por el
 * modo simulado ni inventar un número global; APO-82 conectará aquí la
 * resolución de `phone_number_id` por Clínica.
 */
export type KapsoWhatsAppSenders = {
  appointmentMessageSender: ManualAppointmentMessageSender;
  appointmentReminderSender: AppointmentReminderSender;
  sendConversationEscalationNotification(input: {
    clinicId: string;
    escalationId: string;
    recipientPhoneE164: string;
    trigger: ConversationEscalationTrigger;
  }): Promise<void>;
};

export class WhatsAppConnectionRequiredError extends Error {
  constructor() {
    super("Kapso requiere una Conexión de WhatsApp activa para esta Clínica");
    this.name = "WhatsAppConnectionRequiredError";
  }
}

export function createKapsoWhatsAppSenders(): KapsoWhatsAppSenders {
  const requireConnection = async () => {
    throw new WhatsAppConnectionRequiredError();
  };

  return {
    appointmentMessageSender: { send: requireConnection },
    appointmentReminderSender: { send: requireConnection },
    sendConversationEscalationNotification: requireConnection,
  };
}
