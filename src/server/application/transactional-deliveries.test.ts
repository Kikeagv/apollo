import { describe, expect, it, vi } from "vitest";

import { WhatsAppUtilityTemplateRequiredError } from "~/domain/whatsapp-delivery";
import {
  captureTransactionalDeliveryCallback,
  retryAt,
  runTransactionalDeliveryWorker,
  type TransactionalDelivery,
  type TransactionalDeliveryStore,
} from "./transactional-deliveries";
import { WhatsAppCircuitBreakerOpenError } from "./whatsapp-provider";

const now = new Date("2026-08-14T12:00:00.000Z");

describe("runTransactionalDeliveryWorker", () => {
  it("conserva la Entrega pendiente si el circuito se abre antes de Kapso", async () => {
    const delivery: TransactionalDelivery = {
      attempts: 1,
      clinicId: "clinic-1",
      id: "delivery-circuit-open",
      idempotencyKey: "appointment-1:24h:contact-1",
      kind: "appointment-reminder",
      payload: {
        appointmentId: "appointment-1",
        appointmentStartsAt: new Date("2026-08-15T12:00:00.000Z"),
        checkpoint: "24h",
        clinicName: "Clínica Central",
        recipient: { id: "contact-1", name: "Ana", phoneE164: "+50370000000" },
      },
    };
    const deferForCircuit = vi
      .fn<NonNullable<TransactionalDeliveryStore["deferForCircuit"]>>()
      .mockResolvedValue(undefined);
    const scheduleRetry = vi
      .fn<TransactionalDeliveryStore["scheduleRetry"]>()
      .mockResolvedValue(undefined);

    await expect(
      runTransactionalDeliveryWorker(
        { now },
        {
          claimReadyDeliveries: vi.fn().mockResolvedValue([delivery]),
          deferForCircuit,
          markFailed: vi.fn(),
          markDelivered: vi.fn(),
          scheduleRetry,
        },
        {
          send: vi
            .fn()
            .mockRejectedValue(new WhatsAppCircuitBreakerOpenError("clinic-1")),
        },
      ),
    ).resolves.toMatchObject({ claimed: 1, retried: 1 });

    const deferredCall = deferForCircuit.mock.calls[0]?.[0];
    expect(deferredCall?.delivery).toEqual(delivery);
    expect(deferredCall?.error).toBeInstanceOf(WhatsAppCircuitBreakerOpenError);
    expect(deferredCall?.now).toEqual(now);
    expect(scheduleRetry).not.toHaveBeenCalled();
  });

  it("reintenta tras vencer la concesión sin cambiar la clave de idempotencia", async () => {
    const delivery: TransactionalDelivery = {
      attempts: 0,
      clinicId: "clinic-1",
      id: "delivery-1",
      idempotencyKey: "appointment-1:24h:contact-1",
      kind: "appointment-reminder",
      payload: {
        appointmentId: "appointment-1",
        appointmentStartsAt: new Date("2026-08-15T12:00:00.000Z"),
        checkpoint: "24h",
        clinicName: "Clínica Central",
        recipient: { id: "contact-1", name: "Ada", phoneE164: "+50370000000" },
      },
    };
    const store = new InMemoryDeliveryStore(delivery);
    const attemptedKeys: string[] = [];
    const providerEffects = new Set<string>();

    await runTransactionalDeliveryWorker({ now }, store, {
      async send(input) {
        attemptedKeys.push(input.idempotencyKey);
        providerEffects.add(input.idempotencyKey);
        throw new Error("el proceso cayó durante el proveedor");
      },
    });
    await runTransactionalDeliveryWorker(
      { now: new Date(now.valueOf() + 10 * 60_000) },
      store,
      {
        async send(input) {
          attemptedKeys.push(input.idempotencyKey);
        },
      },
    );

    expect(attemptedKeys).toEqual([
      "appointment-1:24h:contact-1",
      "appointment-1:24h:contact-1",
    ]);
    expect([...providerEffects]).toEqual(["appointment-1:24h:contact-1"]);
    expect(store.sent).toBe(true);
  });

  it("programa los cuatro reintentos con el reloj controlado", () => {
    expect(retryAt(1, now)).toEqual(new Date("2026-08-14T12:01:00.000Z"));
    expect(retryAt(2, now)).toEqual(new Date("2026-08-14T12:05:00.000Z"));
    expect(retryAt(3, now)).toEqual(new Date("2026-08-14T12:15:00.000Z"));
    expect(retryAt(4, now)).toEqual(new Date("2026-08-14T13:00:00.000Z"));
    expect(retryAt(5, now)).toBeUndefined();
  });

  it("marca una plantilla Utility inválida como fallo definitivo", async () => {
    const delivery: TransactionalDelivery = {
      attempts: 1,
      clinicId: "clinic-1",
      id: "delivery-invalid-template",
      idempotencyKey: "appointment-1:24h:contact-1",
      kind: "appointment-reminder",
      payload: {
        appointmentId: "appointment-1",
        appointmentStartsAt: new Date("2026-08-15T12:00:00.000Z"),
        checkpoint: "24h",
        clinicName: "Clínica Central",
        recipient: { id: "contact-1", name: "Ana", phoneE164: "+50370000000" },
      },
    };
    const markFailed = vi
      .fn<NonNullable<TransactionalDeliveryStore["markFailed"]>>()
      .mockResolvedValue(undefined);
    const scheduleRetry = vi
      .fn<TransactionalDeliveryStore["scheduleRetry"]>()
      .mockResolvedValue(undefined);

    await expect(
      runTransactionalDeliveryWorker(
        { now },
        {
          claimReadyDeliveries: vi.fn().mockResolvedValue([delivery]),
          markDelivered: vi.fn(),
          markFailed,
          scheduleRetry,
        },
        {
          send: vi
            .fn()
            .mockRejectedValue(new WhatsAppUtilityTemplateRequiredError()),
        },
      ),
    ).resolves.toMatchObject({ claimed: 1, failed: 1, retried: 0 });

    expect(markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ delivery, now }),
    );
    expect(scheduleRetry).not.toHaveBeenCalled();
  });

  it("mantiene el contenido preparado administrativo, sin detalles clínicos", async () => {
    const delivery: TransactionalDelivery = {
      attempts: 0,
      clinicId: "clinic-1",
      id: "delivery-2",
      idempotencyKey: "doctor-1:2026-08-14",
      kind: "daily-agenda-pdf",
      payload: {
        agenda: [
          { patientName: "Ada", startsAt: new Date("2026-08-15T10:00:00Z") },
        ],
        clinicName: "Clínica Central",
        doctorName: "Dra. Ruiz",
        recipientEmail: "ruiz@example.test",
      },
    };
    const store = new InMemoryDeliveryStore(delivery);
    let delivered: TransactionalDelivery | undefined;

    await runTransactionalDeliveryWorker({ now }, store, {
      async send(input) {
        delivered = input;
      },
    });

    expect(delivered).toMatchObject({
      ...delivery,
      attempts: 1,
    });
    expect(JSON.stringify(delivered)).not.toContain("specialty");
    expect(JSON.stringify(delivered)).not.toContain("reason");
  });

  it("conserva el ID externo en accepted y espera el webhook antes de marcar entregado", async () => {
    const delivery: TransactionalDelivery = {
      attempts: 0,
      clinicId: "clinic-1",
      id: "delivery-accepted",
      idempotencyKey: "appointment-1:24h:contact-1",
      kind: "appointment-reminder",
      payload: {
        appointmentId: "appointment-1",
        appointmentStartsAt: new Date("2026-08-15T12:00:00.000Z"),
        checkpoint: "24h",
        clinicName: "Clínica Central",
        recipient: { id: "contact-1", name: "Ana", phoneE164: "+50370000000" },
      },
    };
    const store = new InMemoryDeliveryStore(delivery);
    const markAccepted = vi
      .fn<NonNullable<TransactionalDeliveryStore["markAccepted"]>>()
      .mockResolvedValue(undefined);
    store.markAccepted = markAccepted;

    await expect(
      runTransactionalDeliveryWorker({ now }, store, {
        async send() {
          return { providerMessageId: "wamid-accepted", status: "accepted" };
        },
      }),
    ).resolves.toMatchObject({ accepted: 1, delivered: 0, unknown: 0 });

    const acceptedCall = markAccepted.mock.calls[0]?.[0];
    expect(acceptedCall?.delivery.id).toBe("delivery-accepted");
    expect(acceptedCall?.delivery.attempts).toBe(1);
    expect(acceptedCall?.now).toEqual(now);
    expect(acceptedCall?.providerMessageId).toBe("wamid-accepted");
    expect(store.sent).toBe(false);
  });

  it("no reenvía automáticamente un timeout ambiguo cuando el almacén ofrece reconciliación", async () => {
    const delivery: TransactionalDelivery = {
      attempts: 0,
      clinicId: "clinic-1",
      id: "delivery-unknown",
      idempotencyKey: "appointment-1:24h:contact-1",
      kind: "appointment-reminder",
      payload: {
        appointmentId: "appointment-1",
        appointmentStartsAt: new Date("2026-08-15T12:00:00.000Z"),
        checkpoint: "24h",
        clinicName: "Clínica Central",
        recipient: { id: "contact-1", name: "Ana", phoneE164: "+50370000000" },
      },
    };
    const store = new InMemoryDeliveryStore(delivery);
    const markUnknown = vi
      .fn<NonNullable<TransactionalDeliveryStore["markUnknown"]>>()
      .mockResolvedValue(undefined);
    store.markUnknown = markUnknown;
    const send = vi.fn().mockRejectedValue(
      Object.assign(new Error("timeout"), {
        ambiguous: true,
        retryable: false,
      }),
    );

    await expect(
      runTransactionalDeliveryWorker({ now }, store, { send }),
    ).resolves.toMatchObject({ retried: 0, unknown: 1 });

    expect(send).toHaveBeenCalledTimes(1);
    const unknownCall = markUnknown.mock.calls[0]?.[0];
    expect(unknownCall?.delivery.id).toBe("delivery-unknown");
    expect(unknownCall?.now).toEqual(now);
    expect(store.retryCalls).toBe(0);
  });

  it("marca como desconocido un envío aceptado si falla su persistencia", async () => {
    const delivery: TransactionalDelivery = {
      attempts: 0,
      clinicId: "clinic-1",
      id: "delivery-persistence-error",
      idempotencyKey: "appointment-1:24h:contact-1",
      kind: "appointment-reminder",
      payload: {
        appointmentId: "appointment-1",
        appointmentStartsAt: new Date("2026-08-15T12:00:00.000Z"),
        checkpoint: "24h",
        clinicName: "Clínica Central",
        recipient: { id: "contact-1", name: "Ana", phoneE164: "+50370000000" },
      },
    };
    const store = new InMemoryDeliveryStore(delivery);
    const markAccepted = vi
      .fn<NonNullable<TransactionalDeliveryStore["markAccepted"]>>()
      .mockRejectedValue(new Error("base no disponible"));
    const markUnknown = vi
      .fn<NonNullable<TransactionalDeliveryStore["markUnknown"]>>()
      .mockResolvedValue(undefined);
    store.markAccepted = markAccepted;
    store.markUnknown = markUnknown;

    await expect(
      runTransactionalDeliveryWorker({ now }, store, {
        send: vi.fn().mockResolvedValue({
          providerMessageId: "wamid-accepted",
          status: "accepted",
        }),
      }),
    ).resolves.toMatchObject({ retried: 0, unknown: 1 });

    const unknownCall = markUnknown.mock.calls[0]?.[0];
    expect(unknownCall?.delivery.id).toBe("delivery-persistence-error");
    expect(unknownCall?.error.message).toContain("base");
    expect(unknownCall?.now).toEqual(now);
    expect(store.retryCalls).toBe(0);
  });

  it("registra el callback una sola vez para una clave lógica", async () => {
    const callbacks = new Map<string, "delivered" | "failed">();
    const store = {
      async recordProviderCallback(input: {
        idempotencyKey: string;
        status: "accepted" | "sent" | "delivered" | "read" | "failed";
      }) {
        if (
          !callbacks.has(input.idempotencyKey) &&
          input.status !== "accepted" &&
          input.status !== "sent" &&
          input.status !== "read"
        ) {
          callbacks.set(input.idempotencyKey, input.status);
        }
      },
    };

    await captureTransactionalDeliveryCallback(
      { idempotencyKey: "appointment-1:24h:contact-1", status: "delivered" },
      store,
    );
    await captureTransactionalDeliveryCallback(
      { idempotencyKey: "appointment-1:24h:contact-1", status: "failed" },
      store,
    );

    expect(callbacks).toEqual(
      new Map([["appointment-1:24h:contact-1", "delivered"]]),
    );
  });
});

class InMemoryDeliveryStore implements TransactionalDeliveryStore {
  markAccepted?: TransactionalDeliveryStore["markAccepted"];
  markUnknown?: TransactionalDeliveryStore["markUnknown"];
  sent = false;
  retryCalls = 0;
  private leasedUntil: Date | undefined;
  private nextAttemptAt = now;

  constructor(private readonly delivery: TransactionalDelivery) {}

  async claimReadyDeliveries(input: { now: Date }) {
    if (
      this.sent ||
      this.nextAttemptAt > input.now ||
      (this.leasedUntil !== undefined && this.leasedUntil > input.now)
    ) {
      return [];
    }
    this.leasedUntil = new Date(input.now.valueOf() + 10 * 60_000);
    return [{ ...this.delivery, attempts: this.delivery.attempts + 1 }];
  }

  async markDelivered() {
    this.sent = true;
  }

  async scheduleRetry(input: { now: Date }) {
    this.retryCalls += 1;
    this.nextAttemptAt = new Date(input.now.valueOf() + 60_000);
  }
}
