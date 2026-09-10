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

  it("rechaza un estado de entrega malformado antes de encolarlo", async () => {
    const rawBody = JSON.stringify({ message: { id: "message-1" } });
    const enqueueDeliveryStatus = vi.fn();
    const response = await createKapsoWebhookHandler({
      secret: "webhook-secret",
      store: {
        enqueue: vi.fn(),
        enqueueIgnored: vi.fn(),
        enqueueDeliveryStatus,
      },
    })(
      new Request("https://app.usepraxia.com/api/webhooks/kapso", {
        body: rawBody,
        headers: {
          "X-Idempotency-Key": "kapso-status-1",
          "X-Webhook-Event": "whatsapp.message.delivered",
          "X-Webhook-Signature": createKapsoWebhookSignature(
            rawBody,
            "webhook-secret",
          ),
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(enqueueDeliveryStatus).not.toHaveBeenCalled();
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
    const rawBody = JSON.stringify({
      message: {
        id: "message-1",
        type: "text",
        from: "50370001111",
        text: { body: "info" },
        kapso: { direction: "inbound", origin: "cloud_api" },
      },
      conversation: {
        id: "conversation-1",
        phone_number: "50370001111",
        phone_number_id: "phone-1",
      },
      phone_number_id: "phone-1",
    });
    const enqueueInbound = vi
      .fn<NonNullable<KapsoProvisioningStore["enqueueInbound"]>>()
      .mockResolvedValue({
        accepted: true,
        eventId: "event-message-1",
      });
    const response = await createKapsoWebhookHandler({
      secret: "webhook-secret",
      store: { enqueue: vi.fn(), enqueueIgnored: vi.fn(), enqueueInbound },
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
    const call = enqueueInbound.mock.calls[0]?.[0];
    if (call === undefined) throw new Error("Falta la llamada inbound");
    expect(call.idempotencyKey).toBe("kapso-message-1");
    expect(call.message.eventName).toBe("whatsapp.message.received");
    expect(call.message.id).toBe("message-1");
  });

  it("acepta un lote y encola cada mensaje con una clave derivada independiente", async () => {
    const payload = {
      type: "whatsapp.message.received",
      batch: true,
      data: [
        {
          message: {
            id: "message-1",
            type: "text",
            from: "50370001111",
            text: { body: "info" },
            kapso: { direction: "inbound", origin: "cloud_api" },
          },
          conversation: {
            id: "conversation-1",
            phone_number: "50370001111",
            phone_number_id: "phone-1",
          },
          phone_number_id: "phone-1",
        },
        {
          message: {
            id: "message-2",
            type: "text",
            from: "US.USER.2",
            text: { body: "servicios" },
            kapso: { direction: "inbound", origin: "cloud_api" },
          },
          conversation: {
            id: "conversation-1",
            phone_number: null,
            business_scoped_user_id: "US.USER.2",
            phone_number_id: "phone-1",
          },
          phone_number_id: "phone-1",
        },
      ],
      batch_info: { first_sequence: 10, last_sequence: 11 },
    };
    const rawBody = JSON.stringify(payload);
    const enqueueInbound = vi
      .fn<NonNullable<KapsoProvisioningStore["enqueueInbound"]>>()
      .mockResolvedValue({
        accepted: true,
        eventId: "queued",
      });

    const response = await createKapsoWebhookHandler({
      secret: "webhook-secret",
      store: {
        enqueue: vi.fn(),
        enqueueIgnored: vi.fn(),
        enqueueInbound,
      },
    })(
      new Request("https://app.usepraxia.com/api/webhooks/kapso", {
        body: rawBody,
        headers: {
          "X-Idempotency-Key": "kapso-batch-1",
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
    expect(enqueueInbound).toHaveBeenCalledTimes(2);
    expect(
      enqueueInbound.mock.calls.map(([call]) => call.idempotencyKey),
    ).toEqual(["kapso-batch-1:message-1", "kapso-batch-1:message-2"]);
    expect(
      enqueueInbound.mock.calls.map(([call]) => call.message.batchSequence),
    ).toEqual([10, 11]);
  });
});
