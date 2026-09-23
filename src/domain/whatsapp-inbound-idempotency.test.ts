import { describe, expect, it } from "vitest";

import {
  WhatsAppInboundIdempotencyConflictError,
  resolveWhatsAppInboundDuplicate,
} from "./whatsapp-inbound-idempotency";

describe("idempotencia de inbound de WhatsApp", () => {
  it("reconoce un replay por phone_number_id y message_id aunque cambie la clave externa", () => {
    expect(
      resolveWhatsAppInboundDuplicate({
        candidates: [
          {
            eventId: "event-1",
            idempotencyKey: "webhook-1",
            messageId: "wamid-1",
            phoneNumberId: "phone-1",
            customerReference: "customer-1",
          },
        ],
        idempotencyKey: "webhook-retry-1",
        messageId: "wamid-1",
        phoneNumberId: "phone-1",
        customerReference: "customer-1",
      }),
    ).toEqual({ eventId: "event-1" });
  });

  it("rechaza reutilizar una clave externa para otro mensaje", () => {
    expect(() =>
      resolveWhatsAppInboundDuplicate({
        candidates: [
          {
            eventId: "event-1",
            idempotencyKey: "webhook-1",
            messageId: "wamid-1",
            phoneNumberId: "phone-1",
            customerReference: "customer-1",
          },
        ],
        idempotencyKey: "webhook-1",
        messageId: "wamid-2",
        phoneNumberId: "phone-1",
        customerReference: "customer-1",
      }),
    ).toThrow(WhatsAppInboundIdempotencyConflictError);
  });

  it("no confunde mensajes homónimos de dos números distintos", () => {
    expect(
      resolveWhatsAppInboundDuplicate({
        candidates: [
          {
            eventId: "event-a",
            idempotencyKey: "webhook-a",
            messageId: "wamid-shared",
            phoneNumberId: "phone-a",
            customerReference: "customer-a",
          },
        ],
        idempotencyKey: "webhook-b",
        messageId: "wamid-shared",
        phoneNumberId: "phone-b",
        customerReference: "customer-b",
      }),
    ).toBeUndefined();
  });

  it("no trata como replay el mismo mensaje de otro customer", () => {
    expect(
      resolveWhatsAppInboundDuplicate({
        candidates: [
          {
            eventId: "event-1",
            idempotencyKey: "webhook-1",
            messageId: "wamid-1",
            phoneNumberId: "phone-1",
            customerReference: "customer-1",
          },
        ],
        idempotencyKey: "webhook-retry-1",
        messageId: "wamid-1",
        phoneNumberId: "phone-1",
        customerReference: "customer-2",
      }),
    ).toBeUndefined();
  });
});
