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
      receivedAt: new Date("2026-09-09T12:00:00.000Z"),
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
      providerEventReceivedAt: new Date("2026-09-09T12:00:00.000Z"),
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
      receivedAt: new Date("2026-09-09T12:00:00.000Z"),
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
      providerEventReceivedAt: new Date("2026-09-09T12:00:00.000Z"),
      providerEventId: "event-1",
      providerMessageId: "wamid-1",
      status: "sent",
    });
  });

  it("conserva la hora de recepción si el worker procesa el acuse después del timeout", async () => {
    const receivedAt = new Date("2026-10-03T19:55:24.042Z");
    const processedAt = new Date("2026-10-03T20:01:06.548Z");
    const event = {
      attempts: 1,
      eventName: "whatsapp.message.delivered",
      id: "template-delivery-event",
      idempotencyKey: "kapso-event-1",
      leaseToken: "lease-1",
      payload: {
        message: { id: "wamid-template-smoke" },
        phone_number_id: "phone-1",
      },
      receivedAt,
      status: "processing" as const,
    };
    const queue = {
      claimDueStatusEvents: vi.fn().mockResolvedValue([event]),
      markStatusProcessed: vi.fn().mockResolvedValue(undefined),
      markStatusRejected: vi.fn(),
      scheduleStatusRetry: vi.fn(),
    };
    const callback = vi.fn().mockResolvedValue(undefined);

    await runTransactionalDeliveryStatusWorker({ now: processedAt }, queue, {
      recordProviderCallback: callback,
    });

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ providerEventReceivedAt: receivedAt }),
    );
  });

  it("publica el estado persistido como métrica operacional", async () => {
    const event = {
      attempts: 1,
      eventName: "whatsapp.message.delivered",
      id: "event-1",
      idempotencyKey: "kapso-event-1",
      leaseToken: "lease-1",
      payload: {
        message: { id: "wamid-1" },
        phone_number_id: "phone-1",
      },
      receivedAt: new Date("2026-09-09T12:00:00.000Z"),
      status: "processing" as const,
    };
    const queue = {
      claimDueStatusEvents: vi.fn().mockResolvedValue([event]),
      markStatusProcessed: vi.fn().mockResolvedValue(undefined),
      markStatusRejected: vi.fn(),
      scheduleStatusRetry: vi.fn(),
    };
    const callback = vi.fn().mockResolvedValue({
      clinicId: "clinic-1",
      errorCode: null,
      idempotencyKey: "delivery-status:event-1",
      metric: { category: "template", direction: "outbound" },
      operation: "transactional-delivery-status",
      outcome: "delivered",
      templateName: "appointment_reminder",
    });
    const observer = {
      recordFailure: vi.fn().mockResolvedValue(undefined),
      recordMetric: vi.fn().mockResolvedValue(undefined),
    };

    await runTransactionalDeliveryStatusWorker(
      { now: new Date("2026-09-09T12:00:00.000Z") },
      queue,
      { recordProviderCallback: callback },
      observer,
    );

    expect(observer.recordMetric).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      errorCode: null,
      idempotencyKey: "delivery-status:event-1",
      latencyMs: null,
      metric: { category: "template", direction: "outbound" },
      occurredAt: new Date("2026-09-09T12:00:00.000Z"),
      operation: "transactional-delivery-status",
      outcome: "delivered",
      templateName: "appointment_reminder",
      workerKind: "delivery-status",
    });
    expect(observer.recordFailure).not.toHaveBeenCalled();
  });

  it("registra los recibos de lectura sin contarlos como mensajes facturables", async () => {
    const event = {
      attempts: 1,
      eventName: "whatsapp.message.read",
      id: "event-read-1",
      idempotencyKey: "kapso-event-read-1",
      leaseToken: "lease-read-1",
      payload: {
        message: { id: "wamid-read-1" },
        phone_number_id: "phone-1",
      },
      receivedAt: new Date("2026-09-09T12:00:00.000Z"),
      status: "processing" as const,
    };
    const queue = {
      claimDueStatusEvents: vi.fn().mockResolvedValue([event]),
      markStatusProcessed: vi.fn().mockResolvedValue(undefined),
      markStatusRejected: vi.fn(),
      scheduleStatusRetry: vi.fn(),
    };
    const callback = vi.fn().mockResolvedValue({
      clinicId: "clinic-1",
      errorCode: null,
      idempotencyKey: "delivery-status:event-read-1",
      metric: { category: "read-receipt", direction: "outbound" },
      operation: "transactional-delivery-status",
      outcome: "read",
      templateName: null,
    });
    const observer = {
      recordFailure: vi.fn().mockResolvedValue(undefined),
      recordMetric: vi.fn().mockResolvedValue(undefined),
    };

    await runTransactionalDeliveryStatusWorker(
      { now: new Date("2026-09-09T12:00:00.000Z") },
      queue,
      { recordProviderCallback: callback },
      observer,
    );

    expect(observer.recordMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: { category: "read-receipt", direction: "outbound" },
        outcome: "read",
      }),
    );
    expect(observer.recordFailure).not.toHaveBeenCalled();
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
          receivedAt: new Date("2026-09-09T12:00:00.000Z"),
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

  it("reintenta la métrica de un callback duplicado sin volver a contar el fallo", async () => {
    const event = {
      attempts: 2,
      eventName: "whatsapp.message.failed" as const,
      id: "event-1",
      idempotencyKey: "kapso-event-1",
      leaseToken: "lease-1",
      payload: {
        message: { id: "wamid-1" },
        phone_number_id: "phone-1",
      },
      receivedAt: new Date("2026-09-09T12:00:00.000Z"),
      status: "processing" as const,
    };
    const queue = {
      claimDueStatusEvents: vi.fn().mockResolvedValue([event]),
      markStatusProcessed: vi.fn().mockResolvedValue(undefined),
      markStatusRejected: vi.fn(),
      scheduleStatusRetry: vi.fn().mockResolvedValue(undefined),
    };
    const callback = vi.fn().mockResolvedValueOnce({
      clinicId: "clinic-1",
      errorCode: "provider-error",
      idempotencyKey: "delivery-status:event-1",
      isNew: true,
      metric: { category: "message", direction: "outbound" },
      operation: "transactional-delivery-status",
      outcome: "failed",
      templateName: null,
    });
    const retryCallback = {
      clinicId: "clinic-1",
      errorCode: "provider-error",
      idempotencyKey: "delivery-status:event-1",
      isNew: false,
      metric: { category: "message", direction: "outbound" },
      operation: "transactional-delivery-status",
      outcome: "failed" as const,
      templateName: null,
    };
    callback.mockResolvedValueOnce(retryCallback);
    const observer = {
      recordFailure: vi.fn().mockResolvedValue(undefined),
      recordMetric: vi
        .fn()
        .mockRejectedValueOnce(new Error("métrica temporalmente no disponible"))
        .mockResolvedValueOnce(undefined),
    };
    const now = new Date("2026-09-09T12:00:00.000Z");

    await expect(
      runTransactionalDeliveryStatusWorker(
        { now },
        queue,
        { recordProviderCallback: callback },
        observer,
      ),
    ).resolves.toMatchObject({ claimed: 1, processed: 0, retried: 1 });
    await expect(
      runTransactionalDeliveryStatusWorker(
        { now },
        queue,
        { recordProviderCallback: callback },
        observer,
      ),
    ).resolves.toMatchObject({ claimed: 1, processed: 1, retried: 0 });

    expect(callback).toHaveBeenCalledTimes(2);
    expect(observer.recordMetric).toHaveBeenCalledTimes(2);
    expect(observer.recordFailure).not.toHaveBeenCalled();
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
          receivedAt: new Date("2026-09-09T12:00:00.000Z"),
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
          receivedAt: new Date("2026-09-09T12:00:00.000Z"),
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
