import "server-only";

import type {
  ManualAppointmentMessageSender,
  ManualAppointmentTransactionalMessage,
} from "~/server/application/manual-appointments";
import type {
  AppointmentReminderSender,
  AppointmentReminderRecipient,
} from "~/server/application/appointment-reminders";

const sentAppointmentMessages: ManualAppointmentTransactionalMessage[] = [];
const sentAppointmentReminders: Array<{
  appointmentId: string;
  clinicId: string;
  recipient: AppointmentReminderRecipient;
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

export function getSentSimulatedAppointmentMessages() {
  return [...sentAppointmentMessages];
}

export function getSentSimulatedAppointmentReminders() {
  return [...sentAppointmentReminders];
}
