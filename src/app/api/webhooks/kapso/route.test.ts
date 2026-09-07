import { describe, expect, it, vi } from "vitest";

import type { KapsoProvisioningStore } from "~/server/application/whatsapp-provisioning";
import { createKapsoWebhookHandler } from "./handler";
import { createKapsoWebhookSignature } from "~/server/whatsapp/kapso-webhook-security";

describe("webhook compartido de Kapso", () => {
  it("responde rápido después de persistir el evento y conserva el cuerpo crudo para HMAC", async () => {
    const enqueue = vi
      .fn<KapsoProvisioningStore["enqueue"]>()
      .mockResolvedValue({
        accepted: true,
        eventId: "event-1",
      });
    const rawBody = ` {"customer":{"id":"customer-1"},"phone_number_id":"phone-1","project":{"id":"project-1"}}\n`;
    const response = await createKapsoWebhookHandler({
      secret: "webhook-secret",
      store: { enqueue, enqueueIgnored: vi.fn() },
    })(
      new Request("https://app.usepraxia.com/api/webhooks/kapso", {
        body: rawBody,
        headers: {
          "X-Idempotency-Key": "kapso-event-1",
          "X-Webhook-Event": "whatsapp.phone_number.created",
          "X-Webhook-Signature": createKapsoWebhookSignature(
            rawBody,
            "webhook-secret",
          ),
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      duplicate: false,
      eventId: "event-1",
    });
    const call = enqueue.mock.calls[0]?.[0];
    expect(call?.idempotencyKey).toBe("kapso-event-1");
    expect(call?.event).toMatchObject({
      customerId: "customer-1",
      phoneNumberId: "phone-1",
    });
  });

  it("rechaza firmas inválidas antes de tocar la cola", async () => {
    const enqueue = vi.fn();
    const response = await createKapsoWebhookHandler({
      secret: "webhook-secret",
      store: { enqueue, enqueueIgnored: vi.fn() },
    })(
      new Request("https://app.usepraxia.com/api/webhooks/kapso", {
        body: "{}",
        headers: {
          "X-Idempotency-Key": "kapso-event-1",
          "X-Webhook-Event": "whatsapp.phone_number.created",
          "X-Webhook-Signature": "sha256=invalid",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("marca duplicados sin volver a procesarlos", async () => {
    const rawBody = JSON.stringify({
      customer: { id: "customer-1" },
      phone_number_id: "phone-1",
      project: { id: "project-1" },
    });
    const response = await createKapsoWebhookHandler({
      secret: "webhook-secret",
      store: {
        enqueue: vi.fn().mockResolvedValue({
          accepted: false,
          eventId: "event-1",
        }),
        enqueueIgnored: vi.fn(),
      },
    })(
      new Request("https://app.usepraxia.com/api/webhooks/kapso", {
        body: rawBody,
        headers: {
          "X-Idempotency-Key": "kapso-event-1",
          "X-Webhook-Event": "whatsapp.phone_number.created",
          "X-Webhook-Signature": createKapsoWebhookSignature(
            rawBody,
            "webhook-secret",
          ),
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      duplicate: true,
      eventId: "event-1",
    });
  });

  it("acepta y conserva la idempotencia de eventos de número reservados para mensajería", async () => {
    const rawBody = JSON.stringify({ id: "message-1" });
    const enqueueIgnored = vi.fn().mockResolvedValue({
      accepted: true,
      eventId: "event-message-1",
    });
    const response = await createKapsoWebhookHandler({
      secret: "webhook-secret",
      store: { enqueue: vi.fn(), enqueueIgnored },
    })(
      new Request("https://app.usepraxia.com/api/webhooks/kapso", {
        body: rawBody,
        headers: {
          "X-Idempotency-Key": "kapso-message-1",
          "X-Webhook-Event": "whatsapp.message.received",
          "X-Webhook-Signature": createKapsoWebhookSignature(
            rawBody,
            "webhook-secret",
          ),
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      duplicate: false,
      eventId: "event-message-1",
    });
    expect(enqueueIgnored).toHaveBeenCalledWith({
      eventName: "whatsapp.message.received",
      idempotencyKey: "kapso-message-1",
      payload: { id: "message-1" },
    });
  });
});
