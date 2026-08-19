import "server-only";

import type { WhatsAppBookingResponse } from "~/server/application/simulated-whatsapp-booking";

export type TwilioWhatsAppWebhookDeps = {
  processTextMessage(input: {
    from: string;
    id: string;
    text: string;
    to: string;
  }): Promise<WhatsAppBookingResponse | undefined>;
  sendConversationalReply(input: {
    body: string;
    fromE164: string;
    toE164: string;
  }): Promise<void>;
  sendUnsupportedMediumReply(input: {
    fromE164: string;
    toE164: string;
  }): Promise<void>;
  verifySignature(input: {
    rawBody: string;
    signature: string | null;
    url: string;
  }): boolean;
};

/**
 * URL exacta que Twilio firmó. Detrás del tunnel/proxy la app recibe localhost,
 * así que se reconstruye desde X-Forwarded-Proto/Host antes de validar la
 * firma; la ruta y el query se conservan tal cual los invocó Twilio.
 */
export function canonicalTwilioWebhookUrl(request: Request): string {
  const url = new URL(request.url);
  const proto =
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  return `${proto}://${host}${url.pathname}${url.search}`;
}

function stripWhatsAppPrefix(value: string): string {
  return value.startsWith("whatsapp:")
    ? value.slice("whatsapp:".length)
    : value;
}

/**
 * Callback de Twilio para mensajes de WhatsApp entrantes. Valida la firma
 * contra la URL canónica, responde rápido y enruta el texto al mismo núcleo
 * de Asclepio; el `MessageSid` es la clave de idempotencia del almacén.
 */
export async function handleTwilioWhatsAppWebhook(
  request: Request,
  deps: TwilioWhatsAppWebhookDeps,
): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-twilio-signature");
  const url = canonicalTwilioWebhookUrl(request);

  if (!deps.verifySignature({ rawBody, signature, url })) {
    return Response.json({}, { status: 401 });
  }

  const payload = new URLSearchParams(rawBody);
  const messageSid = payload.get("MessageSid");
  if (messageSid === null || messageSid === "") {
    return Response.json({}, { status: 200 });
  }

  const fromE164 = stripWhatsAppPrefix(payload.get("From") ?? "");
  const toE164 = stripWhatsAppPrefix(payload.get("To") ?? "");
  const numberOfMedia = Number(payload.get("NumMedia") ?? "0");

  if (numberOfMedia > 0) {
    await deps.sendUnsupportedMediumReply({ fromE164, toE164 });
    return Response.json({}, { status: 200 });
  }

  const response = await deps.processTextMessage({
    from: fromE164,
    id: messageSid,
    text: payload.get("Body") ?? "",
    to: toE164,
  });
  if (response !== undefined) {
    await deps.sendConversationalReply({
      body: response.text,
      fromE164: toE164,
      toE164: fromE164,
    });
  }
  return Response.json({}, { status: 200 });
}
