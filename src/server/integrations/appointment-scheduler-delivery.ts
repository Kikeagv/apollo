import type {
  AppointmentReminderSender,
  DailyAgendaEmailSender,
} from "~/server/application/appointment-reminders";
import { simulatedDailyAgendaEmailSender } from "~/server/email/simulated-identity-email";
import { whatsAppSender } from "~/server/whatsapp/whatsapp-delivery";

/**
 * Adaptadores de entrega del agendador. La recordatorio de Cita sale por el
 * canal de WhatsApp seleccionado (WHATSAPP_DELIVERY); la agenda diaria por
 * correo sigue simulada hasta su propio ticket.
 */
export function appointmentSchedulerDeliveryAdapters(): {
  agendaEmailSender: DailyAgendaEmailSender;
  reminderSender: AppointmentReminderSender;
} {
  return {
    agendaEmailSender: simulatedDailyAgendaEmailSender,
    reminderSender: whatsAppSender().appointmentReminderSender,
  };
}
