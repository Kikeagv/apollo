import { env } from "~/env";
import { runAppointmentScheduler } from "~/server/application/appointment-reminders";
import { drizzleManualAppointmentStore } from "~/server/db/manual-appointment-store";
import { drizzleAppointmentSchedulerStore } from "~/server/db/appointment-scheduler-store";
import { appointmentSchedulerDeliveryAdapters } from "~/server/integrations/appointment-scheduler-delivery";

/** Entrada protegida del job de producción; los adaptadores siguen simulados. */
export async function POST(request: Request) {
  if (
    env.SCHEDULER_SECRET === undefined ||
    request.headers.get("authorization") !== `Bearer ${env.SCHEDULER_SECRET}`
  ) {
    return new Response("No autorizado", { status: 401 });
  }
  const delivery = appointmentSchedulerDeliveryAdapters();
  const result = await runAppointmentScheduler(
    { now: new Date() },
    drizzleAppointmentSchedulerStore,
    drizzleManualAppointmentStore,
    delivery.reminderSender,
    delivery.agendaEmailSender,
  );
  return Response.json(result);
}
