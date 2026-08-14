import "server-only";

import type {
  ManualAppointmentMessageSender,
  ManualAppointmentTransactionalMessage,
} from "~/server/application/manual-appointments";
import type {
  AppointmentReminderSender,
  AppointmentReminderRecipient,
} from "~/server/application/appointment-reminders";
import type { ConversationEscalationTrigger } from "~/server/application/conversation-escalations";

const sentAppointmentMessages: ManualAppointmentTransactionalMessage[] = [];
const sentAppointmentReminders: Array<{
  appointmentId: string;
  clinicId: string;
  idempotencyKey?: string;
  recipient: AppointmentReminderRecipient;
}> = [];
const sentConversationEscalationNotifications: Array<{
  clinicId: string;
  escalationId: string;
  recipientPhoneE164: string;
  trigger: ConversationEscalationTrigger;
}> = [];

/** Adaptador simulado de WhatsApp para Mensajes transaccionales de Cita. */
export const simulatedAppointmentMessageSender: ManualAppointmentMessageSender =
  {
    async send(message) {
      sentAppointmentMessages.push(message);
    },
  };

/** Adaptador simulado para recordatorios proactivos de Citas. */
export const simulatedAppointmentReminderSender: AppointmentReminderSender = {
  async send(reminder) {
    sentAppointmentReminders.push(reminder);
  },
};

/** El proveedor simulado aplica la misma deduplicación que un proveedor real. */
export async function sendSimulatedAppointmentReminder(input: {
  appointmentId: string;
  clinicId: string;
  idempotencyKey: string;
  recipient: AppointmentReminderRecipient;
}) {
  if (
    sentAppointmentReminders.some(
      (reminder) => reminder.idempotencyKey === input.idempotencyKey,
    )
  ) {
    return;
  }
  sentAppointmentReminders.push(input);
}

/** Adaptador simulado del aviso adicional a la secretaria de la Clínica. */
export async function sendSimulatedConversationEscalationNotification(input: {
  clinicId: string;
  escalationId: string;
  recipientPhoneE164: string;
  trigger: ConversationEscalationTrigger;
}) {
  sentConversationEscalationNotifications.push(input);
}

export function getSentSimulatedAppointmentMessages() {
  return [...sentAppointmentMessages];
}

export function getSentSimulatedAppointmentReminders() {
  return [...sentAppointmentReminders];
}

export function getSentSimulatedConversationEscalationNotifications() {
  return [...sentConversationEscalationNotifications];
}
