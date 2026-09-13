import { env } from "~/env";
import { runKapsoInboundWorker } from "~/server/application/whatsapp-inbound";
import {
  processWhatsAppConsentSafeRoute,
  processWhatsAppTextForContact,
} from "~/server/application/simulated-whatsapp-booking";
import {
  activateWhatsAppHumanTakeover,
  isWhatsAppHumanTakeoverActive,
  type WhatsAppHumanTakeoverStore,
} from "~/server/application/whatsapp-human-takeover";
import { createWhatsAppConsentGate } from "~/server/application/whatsapp-consent";
import { drizzleSimulatedWhatsAppBookingStore } from "~/server/db/simulated-whatsapp-booking-store";
import { drizzleWhatsAppInboundStore } from "~/server/db/whatsapp-inbound-store";
import {
  reactivatePendingWhatsAppDeliveries,
  suppressPendingReminderDeliveries,
  suppressPendingWhatsAppDeliveries,
} from "~/server/db/transactional-delivery-store";
import { requireWhatsAppConnectionReady } from "~/server/db/whatsapp-connection-store";
import { createKapsoInboundReplySender } from "~/server/whatsapp/kapso-whatsapp";
import { drizzleWhatsAppCircuitBreakerStore } from "~/server/db/whatsapp-circuit-breaker-store";

/** Drena mensajes Kapso ya autenticados, manteniendo la entrada HTTP rápida. */
export async function POST(request: Request) {
  if (
    env.SCHEDULER_SECRET === undefined ||
    request.headers.get("authorization") !== `Bearer ${env.SCHEDULER_SECRET}`
  ) {
    return new Response("No autorizado", { status: 401 });
  }

  const inboundReplySender = createKapsoInboundReplySender();
  const takeoverStore: WhatsAppHumanTakeoverStore = {
    getConversation: (input) =>
      drizzleSimulatedWhatsAppBookingStore.getConversation(input),
    openHumanTakeover: (input) =>
      drizzleSimulatedWhatsAppBookingStore.openHumanTakeover(input),
    // El aviso entra a la outbox; el estado de notificación se confirma cuando
    // el worker outbound recibe la aceptación de Kapso.
    notifySecretaryOfConversationEscalation: (input) =>
      inboundReplySender.send({
        clinicId: input.clinicId,
        idempotencyKey: `escalation:${input.escalationId}`,
        recipientBusinessScopedUserId: null,
        recipientPhoneE164: input.recipientPhoneE164,
        text: "La Clínica recibió tu solicitud y una persona te contactará pronto.",
      }),
  };

  const result = await runKapsoInboundWorker(
    { now: new Date() },
    {
      ...drizzleWhatsAppInboundStore,
      reactivatePendingWhatsAppDeliveries,
      suppressPendingReminderDeliveries,
      suppressPendingWhatsAppDeliveries,
    },
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
    createWhatsAppConsentGate(drizzleWhatsAppInboundStore),
    createKapsoInboundReplySender(),
    {
      process: async (input) => {
        await requireWhatsAppConnectionReady({
          clinicId: input.clinicId,
          provider: "kapso",
        });
        const response = await processWhatsAppConsentSafeRoute(
          input,
          drizzleSimulatedWhatsAppBookingStore,
          input.now,
        );
        return { text: response.text };
      },
    },
    {
      isActive: (input) => isWhatsAppHumanTakeoverActive(input, takeoverStore),
      activate: (input) => activateWhatsAppHumanTakeover(input, takeoverStore),
    },
    drizzleWhatsAppCircuitBreakerStore,
  );
  return Response.json(result);
}
