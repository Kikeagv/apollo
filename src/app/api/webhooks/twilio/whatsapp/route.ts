import twilio from "twilio";

import { NextResponse } from "next/server";

import { processSimulatedWhatsAppMessage } from "~/server/application/simulated-whatsapp-booking";
import { env } from "~/env";
import { drizzleSimulatedWhatsAppBookingStore } from "~/server/db/simulated-whatsapp-booking-store";
import { suppressPendingReminderDeliveries } from "~/server/db/transactional-delivery-store";
import { createTwilioWhatsAppSenders } from "~/server/whatsapp/twilio-whatsapp";
import { handleTwilioWhatsAppWebhook } from "~/server/whatsapp/twilio-webhook";

/**
 * Callback público de WhatsApp vía Twilio (ruta exacta, ADR 0003). Sin
 * desafíos del perímetro; la autenticidad la decide la firma X-Twilio-
 * Signature y la idempotencia el MessageSid en el origen. Devuelve 404
 * mientras el adaptador simulado sigue activo (WHATSAPP_DELIVERY != twilio).
 */
export async function POST(request: Request) {
  if (env.WHATSAPP_DELIVERY !== "twilio") {
    return NextResponse.json({}, { status: 404 });
  }

  const senders = createTwilioWhatsAppSenders();

  return handleTwilioWhatsAppWebhook(request, {
    processTextMessage: (input) =>
      processSimulatedWhatsAppMessage(input, {
        ...drizzleSimulatedWhatsAppBookingStore,
        notifySecretaryOfConversationEscalation: (input) =>
          senders.sendConversationEscalationNotification(input),
        suppressPendingReminderDeliveries,
      }),
    sendConversationalReply: (input) => senders.sendConversationalReply(input),
    sendUnsupportedMediumReply: (input) =>
      senders.sendUnsupportedMediumReply(input),
    verifySignature: ({ rawBody, signature, url }) => {
      if (signature === null) return false;
      return twilio.validateRequestWithBody(
        env.TWILIO_AUTH_TOKEN ?? "",
        signature,
        url,
        rawBody,
      );
    },
  });
}
