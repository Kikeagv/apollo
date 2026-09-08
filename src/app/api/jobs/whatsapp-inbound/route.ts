import { env } from "~/env";
import {
  pendingWhatsAppConsentGate,
  runKapsoInboundWorker,
} from "~/server/application/whatsapp-inbound";
import { processWhatsAppTextForContact } from "~/server/application/simulated-whatsapp-booking";
import { drizzleSimulatedWhatsAppBookingStore } from "~/server/db/simulated-whatsapp-booking-store";
import { drizzleWhatsAppInboundStore } from "~/server/db/whatsapp-inbound-store";
import { requireWhatsAppConnectionReady } from "~/server/db/whatsapp-connection-store";
import { createKapsoInboundReplySender } from "~/server/whatsapp/kapso-whatsapp";

/** Drena mensajes Kapso ya autenticados, manteniendo la entrada HTTP rápida. */
export async function POST(request: Request) {
  if (
    env.SCHEDULER_SECRET === undefined ||
    request.headers.get("authorization") !== `Bearer ${env.SCHEDULER_SECRET}`
  ) {
    return new Response("No autorizado", { status: 401 });
  }

  const result = await runKapsoInboundWorker(
    { now: new Date() },
    drizzleWhatsAppInboundStore,
    {
      processText: async (input) => {
        await requireWhatsAppConnectionReady({
          clinicId: input.clinicId,
          provider: "kapso",
        });
        const response = await processWhatsAppTextForContact(
          input,
          drizzleSimulatedWhatsAppBookingStore,
          input.now,
        );
        return { text: response.text };
      },
    },
    pendingWhatsAppConsentGate,
    createKapsoInboundReplySender(),
  );
  return Response.json(result);
}
