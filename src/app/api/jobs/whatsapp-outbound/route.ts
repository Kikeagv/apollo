import { env } from "~/env";
import { runTransactionalDeliveryStatusWorker } from "~/server/application/transactional-delivery-status";
import { runWhatsAppOutboundReplyWorker } from "~/server/application/whatsapp-outbound";
import { drizzleTransactionalDeliveryCallbackStore } from "~/server/db/transactional-delivery-store";
import { drizzleTransactionalDeliveryStatusStore } from "~/server/db/transactional-delivery-store";
import { drizzleWhatsAppInboundStore } from "~/server/db/whatsapp-inbound-store";
import { createKapsoInboundReplyProvider } from "~/server/whatsapp/kapso-whatsapp";
import { drizzleWhatsAppCircuitBreakerStore } from "~/server/db/whatsapp-circuit-breaker-store";
import { drizzleWhatsAppBillingCapacityStore } from "~/server/db/whatsapp-billing-capacity-store";

/** Drena respuestas y reconcilia estados después de que Kapso aceptó el envío. */
export async function POST(request: Request) {
  if (
    env.SCHEDULER_SECRET === undefined ||
    request.headers.get("authorization") !== `Bearer ${env.SCHEDULER_SECRET}`
  ) {
    return new Response("No autorizado", { status: 401 });
  }

  const now = new Date();
  const replies = await runWhatsAppOutboundReplyWorker(
    { now },
    drizzleWhatsAppInboundStore,
    createKapsoInboundReplyProvider({
      reserveCapacity: drizzleWhatsAppBillingCapacityStore,
    }),
    drizzleWhatsAppCircuitBreakerStore,
  );
  const statuses = await runTransactionalDeliveryStatusWorker(
    { now },
    drizzleTransactionalDeliveryStatusStore,
    drizzleTransactionalDeliveryCallbackStore,
    drizzleWhatsAppCircuitBreakerStore,
  );
  return Response.json({ replies, statuses });
}
