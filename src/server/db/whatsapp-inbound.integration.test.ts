import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { WhatsAppInboundMessage } from "~/domain/whatsapp-inbound";
import { db } from "./index";
import { drizzleWhatsAppInboundStore } from "./whatsapp-inbound-store";
import { whatsappInboundMessages } from "./schema";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("persistencia durable del inbound de WhatsApp", () => {
  databaseTest(
    "hace idempotentes los replays y rechaza colisiones de claves sin cruzar mensajes",
    async () => {
      const phoneNumberId = `apo-104-phone-${randomUUID()}`;
      const messageId = `apo-104-message-${randomUUID()}`;
      const firstIdempotencyKey = `apo-104-webhook-${randomUUID()}`;
      const replayIdempotencyKey = `apo-104-replay-${randomUUID()}`;
      const message = createMessage({
        customerReference: "customer-1",
        messageId,
        phoneNumberId,
      });

      try {
        const first = await drizzleWhatsAppInboundStore.enqueueInbound({
          idempotencyKey: firstIdempotencyKey,
          message,
        });
        expect(first.accepted).toBe(true);

        await expect(
          drizzleWhatsAppInboundStore.enqueueInbound({
            idempotencyKey: replayIdempotencyKey,
            message,
          }),
        ).resolves.toEqual({ accepted: false, eventId: first.eventId });

        await expect(
          drizzleWhatsAppInboundStore.enqueueInbound({
            idempotencyKey: firstIdempotencyKey,
            message: createMessage({
              customerReference: "customer-1",
              messageId: `${messageId}-other`,
              phoneNumberId,
            }),
          }),
        ).rejects.toThrow(
          "La clave de idempotencia ya pertenece a otro mensaje entrante de WhatsApp",
        );

        await expect(
          drizzleWhatsAppInboundStore.enqueueInbound({
            idempotencyKey: replayIdempotencyKey,
            message: createMessage({
              customerReference: "customer-2",
              messageId,
              phoneNumberId,
            }),
          }),
        ).resolves.toMatchObject({ accepted: true });

        await expect(
          drizzleWhatsAppInboundStore.enqueueInbound({
            idempotencyKey: firstIdempotencyKey,
            message: createMessage({
              customerReference: "customer-2",
              messageId: `${messageId}-other-clinic`,
              phoneNumberId,
            }),
          }),
        ).resolves.toMatchObject({ accepted: true });
      } finally {
        await db
          .delete(whatsappInboundMessages)
          .where(eq(whatsappInboundMessages.phoneNumberId, phoneNumberId));
      }
    },
  );
});

function createMessage(input: {
  customerReference?: string | null;
  messageId: string;
  phoneNumberId: string;
}): WhatsAppInboundMessage {
  return {
    batchFirstSequence: null,
    batchSequence: null,
    businessScopedUserId: "US.APO104.TEST",
    connectionReference: input.phoneNumberId,
    conversationId: "apo-104-conversation",
    customerReference: input.customerReference ?? null,
    direction: "inbound",
    eventName: "whatsapp.message.received",
    fromWaId: "+50370001004",
    id: input.messageId,
    interactiveAction: null,
    messageTimestamp: new Date("2026-09-22T12:00:00.000Z"),
    origin: "api",
    parentBusinessScopedUserId: null,
    phoneE164: "+50370001004",
    rawPayload: { message: { id: input.messageId } },
    text: "hola",
    type: "text",
    username: null,
  };
}
