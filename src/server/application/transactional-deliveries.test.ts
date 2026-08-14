import { describe, expect, it } from "vitest";

import {
  captureTransactionalDeliveryCallback,
  retryAt,
  runTransactionalDeliveryWorker,
  type TransactionalDelivery,
  type TransactionalDeliveryStore,
} from "./transactional-deliveries";

const now = new Date("2026-08-14T12:00:00.000Z");

describe("runTransactionalDeliveryWorker", () => {
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

  it("registra el callback una sola vez para una clave lógica", async () => {
    const callbacks = new Map<string, "delivered" | "failed">();
    const store = {
      async recordProviderCallback(input: {
        idempotencyKey: string;
        status: "delivered" | "failed";
      }) {
        if (!callbacks.has(input.idempotencyKey)) {
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
  sent = false;
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
    this.nextAttemptAt = new Date(input.now.valueOf() + 60_000);
  }
}
