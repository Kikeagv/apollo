import { describe, expect, it, vi } from "vitest";

import {
  runTransactionalDeliveryStatusWorker,
  TransactionalDeliveryStatusNotFoundError,
} from "./transactional-delivery-status";

describe("worker de estados de Entrega transaccional", () => {
  it("correlaciona el webhook por clave opaca y conserva el ID externo", async () => {
    const event = {
      attempts: 1,
      eventName: "whatsapp.message.delivered",
      id: "event-1",
      idempotencyKey: "kapso-event-1",
      leaseToken: "lease-1",
      payload: {
        biz_opaque_callback_data: "appointment-1:24h:contact-1",
        message: { id: "wamid-1" },
        phone_number_id: "phone-1",
      },
      status: "processing" as const,
    };
    const queue = {
      claimDueStatusEvents: vi.fn().mockResolvedValue([event]),
      markStatusProcessed: vi.fn().mockResolvedValue(undefined),
      markStatusRejected: vi.fn().mockResolvedValue(undefined),
      scheduleStatusRetry: vi.fn().mockResolvedValue(undefined),
    };
    const callback = vi.fn().mockResolvedValue(undefined);

    await expect(
      runTransactionalDeliveryStatusWorker(
        { now: new Date("2026-09-09T12:00:00.000Z") },
        queue,
        { recordProviderCallback: callback },
      ),
    ).resolves.toEqual({ claimed: 1, processed: 1, rejected: 0, retried: 0 });

    expect(callback).toHaveBeenCalledWith({
      idempotencyKey: "appointment-1:24h:contact-1",
      phoneNumberId: "phone-1",
      providerEventId: "event-1",
      providerMessageId: "wamid-1",
      status: "delivered",
    });
    expect(queue.markStatusProcessed).toHaveBeenCalledWith({
      eventId: "event-1",
      leaseToken: "lease-1",
      processedAt: new Date("2026-09-09T12:00:00.000Z"),
    });
  });

  it("puede correlacionar por ID externo cuando Kapso no devuelve la clave opaca", async () => {
    const event = {
      attempts: 1,
      eventName: "whatsapp.message.sent",
      id: "event-1",
      idempotencyKey: "kapso-event-1",
      leaseToken: "lease-1",
      payload: {
        message: { id: "wamid-1" },
        phone_number_id: "phone-1",
      },
      status: "processing" as const,
    };
    const queue = {
      claimDueStatusEvents: vi.fn().mockResolvedValue([event]),
      markStatusProcessed: vi.fn().mockResolvedValue(undefined),
      markStatusRejected: vi.fn(),
      scheduleStatusRetry: vi.fn(),
    };
    const callback = vi.fn().mockResolvedValue(undefined);

    await runTransactionalDeliveryStatusWorker(
      { now: new Date("2026-09-09T12:00:00.000Z") },
      queue,
      { recordProviderCallback: callback },
    );

    expect(callback).toHaveBeenCalledWith({
      phoneNumberId: "phone-1",
      providerEventId: "event-1",
      providerMessageId: "wamid-1",
      status: "sent",
    });
  });

  it("reintenta un estado que no pudo persistirse sin llamar de nuevo al proveedor", async () => {
    const queue = {
      claimDueStatusEvents: vi.fn().mockResolvedValue([
        {
          attempts: 2,
          eventName: "whatsapp.message.failed",
          id: "event-1",
          idempotencyKey: "kapso-event-1",
          leaseToken: "lease-1",
          payload: {
            message: { id: "wamid-1" },
            phone_number_id: "phone-1",
          },
          status: "processing" as const,
        },
      ]),
      markStatusProcessed: vi.fn(),
      markStatusRejected: vi.fn(),
      scheduleStatusRetry: vi.fn().mockResolvedValue(undefined),
    };
    const callback = vi
      .fn()
      .mockRejectedValue(new Error("Entrega todavía no existe"));
    const now = new Date("2026-09-09T12:00:00.000Z");

    await expect(
      runTransactionalDeliveryStatusWorker({ now }, queue, {
        recordProviderCallback: callback,
      }),
    ).resolves.toMatchObject({ claimed: 1, processed: 0, retried: 1 });

    expect(queue.scheduleStatusRetry).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "event-1", leaseToken: "lease-1" }),
    );
    expect(queue.markStatusRejected).not.toHaveBeenCalled();
  });

  it("reintenta un estado que llegó antes que la Entrega", async () => {
    const queue = {
      claimDueStatusEvents: vi.fn().mockResolvedValue([
        {
          attempts: 2,
          eventName: "whatsapp.message.delivered",
          id: "event-1",
          idempotencyKey: "kapso-event-1",
          leaseToken: "lease-1",
          payload: {
            message: { id: "wamid-1" },
            phone_number_id: "phone-1",
          },
          status: "processing" as const,
        },
      ]),
      markStatusProcessed: vi.fn(),
      markStatusRejected: vi.fn(),
      scheduleStatusRetry: vi.fn().mockResolvedValue(undefined),
    };
    const callback = vi
      .fn()
      .mockRejectedValue(new TransactionalDeliveryStatusNotFoundError());
    const now = new Date("2026-09-09T12:00:00.000Z");

    await expect(
      runTransactionalDeliveryStatusWorker({ now }, queue, {
        recordProviderCallback: callback,
      }),
    ).resolves.toMatchObject({ claimed: 1, processed: 0, retried: 1 });

    expect(queue.scheduleStatusRetry).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "event-1", leaseToken: "lease-1" }),
    );
    expect(queue.markStatusRejected).not.toHaveBeenCalled();
  });

  it("rechaza después del máximo de reintentos si la Entrega nunca aparece", async () => {
    const queue = {
      claimDueStatusEvents: vi.fn().mockResolvedValue([
        {
          attempts: 5,
          eventName: "whatsapp.message.read",
          id: "event-1",
          idempotencyKey: "kapso-event-1",
          leaseToken: "lease-1",
          payload: {
            message: { id: "wamid-1" },
            phone_number_id: "phone-1",
          },
          status: "processing" as const,
        },
      ]),
      markStatusProcessed: vi.fn(),
      markStatusRejected: vi.fn().mockResolvedValue(undefined),
      scheduleStatusRetry: vi.fn(),
    };
    const callback = vi
      .fn()
      .mockRejectedValue(new TransactionalDeliveryStatusNotFoundError());
    const now = new Date("2026-09-09T12:00:00.000Z");

    await expect(
      runTransactionalDeliveryStatusWorker({ now }, queue, {
        recordProviderCallback: callback,
      }),
    ).resolves.toMatchObject({ claimed: 1, processed: 0, rejected: 1 });

    expect(queue.markStatusRejected).toHaveBeenCalledWith({
      eventId: "event-1",
      leaseToken: "lease-1",
      processedAt: now,
      reason: "El estado Kapso no corresponde a una Entrega conocida",
    });
    expect(queue.scheduleStatusRetry).not.toHaveBeenCalled();
  });
});
