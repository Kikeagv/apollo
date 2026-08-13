import type {
  AppointmentReminderSender,
  DailyAgendaEmailSender,
} from "~/server/application/appointment-reminders";
import { env } from "~/env";
import { simulatedDailyAgendaEmailSender } from "~/server/email/simulated-identity-email";
import { simulatedAppointmentReminderSender } from "~/server/whatsapp/simulated-appointment-messages";

/**
 * Puerto de entrega seleccionable por configuración. El piloto mantiene los
 * adaptadores simulados; una activación real sustituye esta selección, no el
 * caso de uso de Agenda.
 */
export function appointmentSchedulerDeliveryAdapters(): {
  agendaEmailSender: DailyAgendaEmailSender;
  reminderSender: AppointmentReminderSender;
} {
  const adapters = {
    simulated: {
      agendaEmailSender: simulatedDailyAgendaEmailSender,
      reminderSender: simulatedAppointmentReminderSender,
    },
  } satisfies Record<
    typeof env.APPOINTMENT_SCHEDULER_DELIVERY,
    {
      agendaEmailSender: DailyAgendaEmailSender;
      reminderSender: AppointmentReminderSender;
    }
  >;
  return adapters[env.APPOINTMENT_SCHEDULER_DELIVERY];
}
