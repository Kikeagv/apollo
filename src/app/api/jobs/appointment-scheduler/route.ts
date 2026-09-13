import { env } from "~/env";
import { runTransactionalDeliveryScheduler } from "~/server/application/transactional-deliveries";
import { drizzleAppointmentSchedulerStore } from "~/server/db/appointment-scheduler-store";
import {
  enqueueDueTransactionalDeliveries,
  purgeExpiredTransactionalDeliveries,
  drizzleTransactionalDeliveryStore,
} from "~/server/db/transactional-delivery-store";
import { transactionalDeliveryAdapter } from "~/server/integrations/transactional-delivery";
import {
  drizzleWhatsAppCircuitBreakerStore,
  purgeExpiredWhatsAppOperationalData,
} from "~/server/db/whatsapp-circuit-breaker-store";

/** Entrada protegida del job de producción: prepara y drena la outbox. */
export async function POST(request: Request) {
  if (
    env.SCHEDULER_SECRET === undefined ||
    request.headers.get("authorization") !== `Bearer ${env.SCHEDULER_SECRET}`
  ) {
    return new Response("No autorizado", { status: 401 });
  }
  const now = new Date();
  const result = await runTransactionalDeliveryScheduler(
    { now },
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
    drizzleWhatsAppCircuitBreakerStore,
  );
  const purgedOperationalData = await purgeExpiredWhatsAppOperationalData({
    now,
  });
  return Response.json({ ...result, ...purgedOperationalData });
}
