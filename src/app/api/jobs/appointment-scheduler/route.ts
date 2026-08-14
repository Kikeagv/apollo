import { env } from "~/env";
import { runTransactionalDeliveryScheduler } from "~/server/application/transactional-deliveries";
import { drizzleAppointmentSchedulerStore } from "~/server/db/appointment-scheduler-store";
import {
  enqueueDueTransactionalDeliveries,
  purgeExpiredTransactionalDeliveries,
  drizzleTransactionalDeliveryStore,
} from "~/server/db/transactional-delivery-store";
import { transactionalDeliveryAdapter } from "~/server/integrations/transactional-delivery";

/** Entrada protegida del job de producción; los adaptadores siguen simulados. */
export async function POST(request: Request) {
  if (
    env.SCHEDULER_SECRET === undefined ||
    request.headers.get("authorization") !== `Bearer ${env.SCHEDULER_SECRET}`
  ) {
    return new Response("No autorizado", { status: 401 });
  }
  const result = await runTransactionalDeliveryScheduler(
    { now: new Date() },
    {
      applyNoShowPolicy: (input) =>
        drizzleAppointmentSchedulerStore.applyNoShowPolicy(input),
      enqueueDueDeliveries: enqueueDueTransactionalDeliveries,
      purgeExpiredDeliveries: purgeExpiredTransactionalDeliveries,
      releaseExpiredReservations: (input) =>
        drizzleAppointmentSchedulerStore.releaseExpiredReservations(input),
    },
    drizzleTransactionalDeliveryStore,
    transactionalDeliveryAdapter(),
  );
  return Response.json(result);
}
