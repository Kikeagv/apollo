import type {
  AppointmentReminderSender,
  DailyAgendaEmailSender,
} from "~/server/application/appointment-reminders";
import type { WhatsAppProvider } from "~/server/application/whatsapp-provider";
import { simulatedDailyAgendaEmailSender } from "~/server/email/simulated-identity-email";
import { whatsAppProviderAdapter } from "~/server/whatsapp/whatsapp-delivery";

/**
 * Adaptadores de entrega del agendador. La recordatorio de Cita sale por el
 * canal de WhatsApp seleccionado (WHATSAPP_DELIVERY); la agenda diaria por
 * correo sigue simulada hasta su propio ticket.
 */
export function appointmentSchedulerDeliveryAdapters(
  provider: WhatsAppProvider = whatsAppProviderAdapter(),
): {
  agendaEmailSender: DailyAgendaEmailSender;
  reminderSender: AppointmentReminderSender;
} {
  return {
    agendaEmailSender: simulatedDailyAgendaEmailSender,
    reminderSender: provider.appointmentReminderSender,
  };
}
