import "server-only";

import type {
  ManualAppointmentMessageSender,
  ManualAppointmentTransactionalMessage,
} from "~/server/application/manual-appointments";

const sentAppointmentMessages: ManualAppointmentTransactionalMessage[] = [];

/** Adaptador simulado de WhatsApp para Mensajes transaccionales de Cita. */
export const simulatedAppointmentMessageSender: ManualAppointmentMessageSender =
  {
    async send(message) {
      sentAppointmentMessages.push(message);
    },
  };

export function getSentSimulatedAppointmentMessages() {
  return [...sentAppointmentMessages];
}
