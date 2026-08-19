import { createHash } from "node:crypto";

import twilio from "twilio";
import { describe, expect, it, vi } from "vitest";

import type { WhatsAppBookingResponse } from "~/server/application/simulated-whatsapp-booking";
import {
  canonicalTwilioWebhookUrl,
  handleTwilioWhatsAppWebhook,
} from "./twilio-webhook";

const AUTH_TOKEN = "clave-secreta-de-firma";
const WEBHOOK_PATH = "/api/webhooks/twilio/whatsapp";

function expectedSignature(authToken: string, url: string): string {
  return twilio.getExpectedTwilioSignature(authToken, url, {});
}

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function signedRequest(
  url: string,
  rawBody: string,
  signature = expectedSignature(AUTH_TOKEN, url),
  forwarded?: { host: string; proto: string },
): Request {
  return new Request(url, {
    body: rawBody,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-host": forwarded?.host ?? "app.usepraxia.com",
      "x-forwarded-proto": forwarded?.proto ?? "https",
      "x-twilio-signature": signature,
    },
    method: "POST",
  });
}

function confirmedResponse(): WhatsAppBookingResponse {
  return {
    id: "apt-1",
    kind: "appointment-confirmed",
    origin: "reservation",
    patientId: "patient-1",
    text: "¡Cita confirmada!",
  };
}

function createDeps() {
  const processTextMessage = vi.fn(async () => confirmedResponse());
  const sendConversationalReply = vi.fn(async () => undefined);
  const sendUnsupportedMediumReply = vi.fn(async () => undefined);
  const verifySignature = vi.fn(
    (input: { rawBody: string; signature: string | null; url: string }) =>
      input.signature !== null &&
      twilio.validateRequestWithBody(
        AUTH_TOKEN,
        input.signature,
        input.url,
        input.rawBody,
      ),
  );
  return {
    processTextMessage,
    sendConversationalReply,
    sendUnsupportedMediumReply,
    verifySignature,
  };
}

describe("canonicalTwilioWebhookUrl", () => {
  it("prefiere los cabeceros X-Forwarded sobre la URL interna", () => {
    const request = new Request(
      "http://localhost:3000/api/webhooks/twilio/whatsapp?x=1",
      {
        headers: {
          "x-forwarded-host": "app.usepraxia.com",
          "x-forwarded-proto": "https",
        },
      },
    );
    expect(canonicalTwilioWebhookUrl(request)).toBe(
      "https://app.usepraxia.com/api/webhooks/twilio/whatsapp?x=1",
    );
  });
});

describe("handleTwilioWhatsAppWebhook", () => {
  it("valida la firma, mapea el texto y responde por WhatsApp", async () => {
    const rawBody = formBody({
      Body: "hola",
      From: "whatsapp:+50370000002",
      MessageSid: "SM00000000000000000000000000000001",
      To: "whatsapp:+50370000001",
    });
    const url = `https://app.usepraxia.com${WEBHOOK_PATH}?bodySHA256=${sha256(rawBody)}`;
    const deps = createDeps();

    const response = await handleTwilioWhatsAppWebhook(
      signedRequest(url, rawBody),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.processTextMessage).toHaveBeenCalledWith({
      from: "+50370000002",
      id: "SM00000000000000000000000000000001",
      text: "hola",
      to: "+50370000001",
    });
    expect(deps.sendConversationalReply).toHaveBeenCalledWith({
      body: "¡Cita confirmada!",
      fromE164: "+50370000001",
      toE164: "+50370000002",
    });
  });

  it("rechaza una firma inválida sin procesar el mensaje", async () => {
    const rawBody = formBody({
      Body: "hola",
      From: "whatsapp:+50370000002",
      MessageSid: "SM00000000000000000000000000000002",
      To: "whatsapp:+50370000001",
    });
    const url = `https://app.usepraxia.com${WEBHOOK_PATH}?bodySHA256=${sha256(rawBody)}`;
    const deps = createDeps();

    const response = await handleTwilioWhatsAppWebhook(
      signedRequest(url, rawBody, "firma-tamperada"),
      deps,
    );

    expect(response.status).toBe(401);
    expect(deps.processTextMessage).not.toHaveBeenCalled();
    expect(deps.sendConversationalReply).not.toHaveBeenCalled();
  });

  it("avisa que las notas de voz aún no se procesan", async () => {
    const rawBody = formBody({
      From: "whatsapp:+50370000002",
      MediaContentType0: "audio/ogg",
      MediaUrl0: "https://api.twilio.com/media/m01",
      MessageSid: "SM00000000000000000000000000000003",
      NumMedia: "1",
      To: "whatsapp:+50370000001",
    });
    const url = `https://app.usepraxia.com${WEBHOOK_PATH}?bodySHA256=${sha256(rawBody)}`;
    const deps = createDeps();

    const response = await handleTwilioWhatsAppWebhook(
      signedRequest(url, rawBody),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.sendUnsupportedMediumReply).toHaveBeenCalledWith({
      fromE164: "+50370000002",
      toE164: "+50370000001",
    });
    expect(deps.processTextMessage).not.toHaveBeenCalled();
  });
});
