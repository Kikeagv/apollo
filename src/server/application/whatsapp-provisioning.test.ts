import { describe, expect, it, vi } from "vitest";

import type { KapsoProvisioningStepName } from "~/domain/whatsapp-kapso-provisioning";

import {
  KapsoProvisioningProviderError,
  receiveKapsoWebhook,
  runKapsoProvisioningWorker,
  type KapsoProvisioningConnection,
  type KapsoProvisioningEvent,
  type KapsoProvisioningProvider,
  type KapsoProvisioningStore,
} from "./whatsapp-provisioning";

function connection(
  overrides: Partial<KapsoProvisioningConnection> = {},
): KapsoProvisioningConnection {
  return {
    businessAccountId: null,
    clinicId: "clinic-1",
    connectionType: "coexistence",
    customer: "customer-1",
    metadata: {},
    phoneNumberE164: null,
    phoneNumberId: null,
    provider: "kapso",
    status: "pending",
    ...overrides,
  };
}

function createFakeStore(initialConnection = connection()) {
  const events: KapsoProvisioningEvent[] = [];
  const steps = new Map<
    string,
    { status: "succeeded" | "failed"; remoteId?: string }
  >();
  let currentConnection = initialConnection;
  let sequence = 0;
  const store: KapsoProvisioningStore = {
    async enqueue(input) {
      if (events.some((item) => item.idempotencyKey === input.idempotencyKey)) {
        return { accepted: false, eventId: events[0]?.id ?? "duplicate" };
      }
      const item: KapsoProvisioningEvent = {
        attempts: 0,
        id: `event-${++sequence}`,
        idempotencyKey: input.idempotencyKey,
        leaseToken: null,
        nextAttemptAt: null,
        payload: input.event,
        receivedAt: new Date(sequence),
        status: "pending",
      };
      events.push(item);
      return { accepted: true, eventId: item.id };
    },
    async enqueueIgnored() {
      return { accepted: true, eventId: "ignored-event" };
    },
    async claimDueEvents(input) {
      const pending = events.filter(
        (item) =>
          item.status === "pending" &&
          (item.nextAttemptAt === null || item.nextAttemptAt <= input.now),
      );
      for (const item of pending) {
        item.status = "processing";
        item.attempts += 1;
        item.leaseToken = `lease-${item.id}-${item.attempts}`;
      }
      return pending;
    },
    async resolveConnection(input) {
      if (
        currentConnection.customer !== input.event.customerId &&
        currentConnection.phoneNumberId !== input.event.phoneNumberId
      ) {
        return { kind: "unknown" };
      }
      if (
        currentConnection.customer !== input.event.customerId ||
        (input.event.eventName === "whatsapp.phone_number.deleted" &&
          currentConnection.phoneNumberId !== input.event.phoneNumberId) ||
        (currentConnection.phoneNumberId !== null &&
          currentConnection.phoneNumberId !== input.event.phoneNumberId) ||
        (input.event.businessAccountId !== null &&
          currentConnection.businessAccountId !== null &&
          currentConnection.businessAccountId !== input.event.businessAccountId)
      ) {
        return { kind: "crossed" };
      }
      return { connection: currentConnection, kind: "matched" };
    },
    async updateConnection(input) {
      currentConnection = {
        ...currentConnection,
        ...input,
        metadata: input.metadata ?? currentConnection.metadata,
      };
    },
    async withWebhookProvisioningLock(input) {
      return input.operation();
    },
    async getStep(input) {
      return steps.get(`${input.eventId}:${input.step}`);
    },
    async hasNewerCreatedEvent(input) {
      return events.some(
        (candidate) =>
          candidate.id !== input.eventId &&
          candidate.status !== "rejected" &&
          candidate.payload.eventName === "whatsapp.phone_number.created" &&
          candidate.receivedAt > input.receivedAt &&
          candidate.payload.phoneNumberId === input.event.phoneNumberId &&
          candidate.payload.customerId === input.event.customerId &&
          candidate.payload.projectId === input.event.projectId,
      );
    },
    async saveStep(input) {
      steps.set(`${input.eventId}:${input.step}`, {
        remoteId: input.remoteId ?? undefined,
        status: input.status,
      });
    },
    async markProcessed(input) {
      const item = events.find((candidate) => candidate.id === input.eventId);
      if (item) item.status = "processed";
    },
    async scheduleRetry(input) {
      const item = events.find((candidate) => candidate.id === input.eventId);
      if (item) {
        item.status = "pending";
        item.nextAttemptAt = input.nextAttemptAt;
      }
    },
    async markRejected(input) {
      const item = events.find((candidate) => candidate.id === input.eventId);
      if (item) item.status = "rejected";
    },
  };
  return {
    events,
    getConnection: () => currentConnection,
    getStep: (eventId: string, step: KapsoProvisioningStepName) =>
      steps.get(`${eventId}:${step}`),
    store,
  };
}

function createFakeProvider(
  overrides: Partial<KapsoProvisioningProvider> = {},
): KapsoProvisioningProvider {
  return {
    getPhoneNumber: vi.fn().mockResolvedValue({
      businessAccountId: "waba-1",
      customerId: "customer-1",
      displayPhoneE164: "+50370000000",
      phoneNumberId: "phone-1",
    }),
    ensureProjectWebhook: vi
      .fn()
      .mockResolvedValue({ remoteId: "project-webhook-1" }),
    ensurePhoneNumberWebhook: vi
      .fn()
      .mockResolvedValue({ remoteId: "phone-webhook-1" }),
    ...overrides,
  };
}

describe("recepción del webhook Kapso", () => {
  it("guarda una sola vez el evento usando la clave de idempotencia", async () => {
    const fake = createFakeStore();
    const payload = {
      customer: { id: "customer-1" },
      phone_number_id: "phone-1",
      project: { id: "project-1" },
    };

    await expect(
      receiveKapsoWebhook({
        eventName: "whatsapp.phone_number.created",
        idempotencyKey: "kapso-event-1",
        payload,
        store: fake.store,
      }),
    ).resolves.toEqual({ accepted: true, eventId: "event-1" });
    await expect(
      receiveKapsoWebhook({
        eventName: "whatsapp.phone_number.created",
        idempotencyKey: "kapso-event-1",
        payload,
        store: fake.store,
      }),
    ).resolves.toEqual({ accepted: false, eventId: "event-1" });
    expect(fake.events).toHaveLength(1);
  });
});

describe("worker de provisión Kapso", () => {
  it("asocia el número y configura ambos webhooks sin declarar ready", async () => {
    const fake = createFakeStore();
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.created",
      idempotencyKey: "kapso-event-1",
      payload: {
        business_account_id: "waba-1",
        customer: { id: "customer-1" },
        display_phone_number: "+50370000000",
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });
    const provider = createFakeProvider();

    await expect(
      runKapsoProvisioningWorker(
        { now: new Date("2026-09-07T12:00:00.000Z") },
        fake.store,
        provider,
      ),
    ).resolves.toMatchObject({ processed: 1 });
    expect(provider.ensureProjectWebhook).toHaveBeenCalledTimes(1);
    expect(provider.ensurePhoneNumberWebhook).toHaveBeenCalledWith("phone-1");
    expect(fake.getConnection()).toMatchObject({
      businessAccountId: "waba-1",
      phoneNumberE164: "+50370000000",
      phoneNumberId: "phone-1",
      status: "provisioning",
    });
    expect(fake.getConnection().metadata.nextAction).toContain("plantillas");
    expect(fake.getConnection().metadata.statusReason).toContain("Webhooks");
    expect(fake.getStep("event-1", "project-webhook")).toMatchObject({
      remoteId: "project-webhook-1",
      status: "succeeded",
    });
  });

  it("serializa la provisión por recurso remoto de Kapso", async () => {
    const fake = createFakeStore();
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.created",
      idempotencyKey: "kapso-lock-1",
      payload: {
        customer: { id: "customer-1" },
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });
    const scopes: string[] = [];
    const store: KapsoProvisioningStore = {
      ...fake.store,
      async withWebhookProvisioningLock(input) {
        scopes.push(input.scope);
        return input.operation();
      },
    };

    await runKapsoProvisioningWorker(
      { now: new Date("2026-09-07T12:00:00.000Z") },
      store,
      createFakeProvider(),
    );

    expect(scopes).toEqual(["lifecycle:phone-1", "project", "phone:phone-1"]);
  });

  it("rechaza una asociación cruzada sin tocar la conexión", async () => {
    const fake = createFakeStore(
      connection({ customer: "customer-other", phoneNumberId: "phone-1" }),
    );
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.created",
      idempotencyKey: "kapso-event-1",
      payload: {
        customer: { id: "customer-1" },
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });
    const provider = createFakeProvider();

    await expect(
      runKapsoProvisioningWorker({ now: new Date() }, fake.store, provider),
    ).resolves.toMatchObject({ rejected: 1 });
    expect(provider.getPhoneNumber).not.toHaveBeenCalled();
    expect(fake.getConnection()).toMatchObject({
      customer: "customer-other",
      phoneNumberId: "phone-1",
      status: "pending",
    });
  });

  it("reintenta solo el paso fallido después de un timeout parcial", async () => {
    const fake = createFakeStore();
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.created",
      idempotencyKey: "kapso-event-1",
      payload: {
        customer: { id: "customer-1" },
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });
    const ensurePhoneNumberWebhook = vi
      .fn()
      .mockRejectedValueOnce(new KapsoProvisioningProviderError(503, "timeout"))
      .mockResolvedValue({ remoteId: "phone-webhook-1" });
    const provider = createFakeProvider({ ensurePhoneNumberWebhook });
    const now = new Date("2026-09-07T12:00:00.000Z");

    await expect(
      runKapsoProvisioningWorker({ now }, fake.store, provider),
    ).resolves.toMatchObject({ retried: 1 });
    expect(fake.getConnection().status).toBe("degraded");

    const retry = fake.events[0];
    if (!retry) throw new Error("Falta el evento de prueba");
    retry.nextAttemptAt = now;
    await expect(
      runKapsoProvisioningWorker({ now }, fake.store, provider),
    ).resolves.toMatchObject({ processed: 1 });
    expect(provider.ensureProjectWebhook).toHaveBeenCalledTimes(1);
    expect(provider.ensurePhoneNumberWebhook).toHaveBeenCalledTimes(2);
    expect(fake.getConnection().status).toBe("provisioning");
  });

  it("reintenta un timeout de red del proveedor", async () => {
    const fake = createFakeStore();
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.created",
      idempotencyKey: "kapso-timeout-1",
      payload: {
        customer: { id: "customer-1" },
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });
    const timeout = Object.assign(new Error("Kapso agotó el tiempo"), {
      name: "TimeoutError",
    });
    const provider = createFakeProvider({
      getPhoneNumber: vi.fn().mockRejectedValue(timeout),
    });

    await expect(
      runKapsoProvisioningWorker({ now: new Date() }, fake.store, provider),
    ).resolves.toMatchObject({ retried: 1 });
    expect(fake.getConnection()).toMatchObject({ status: "degraded" });
  });

  it("mantiene disconnected cuando un evento creado llega después del eliminado", async () => {
    const fake = createFakeStore(connection({ status: "disconnected" }));
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.created",
      idempotencyKey: "kapso-event-1",
      payload: {
        customer: { id: "customer-1" },
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });
    const provider = createFakeProvider();

    await expect(
      runKapsoProvisioningWorker({ now: new Date() }, fake.store, provider),
    ).resolves.toMatchObject({ processed: 1 });
    expect(provider.ensureProjectWebhook).not.toHaveBeenCalled();
    expect(fake.getConnection().status).toBe("disconnected");
  });

  it("no demota una conexión lista cuando se repite el created", async () => {
    const fake = createFakeStore(
      connection({ phoneNumberId: "phone-1", status: "ready" }),
    );
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.created",
      idempotencyKey: "kapso-ready-replay-1",
      payload: {
        customer: { id: "customer-1" },
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });
    const provider = createFakeProvider();

    await expect(
      runKapsoProvisioningWorker({ now: new Date() }, fake.store, provider),
    ).resolves.toMatchObject({ processed: 1 });
    expect(provider.getPhoneNumber).not.toHaveBeenCalled();
    expect(fake.getConnection().status).toBe("ready");
  });

  it("desconecta un número conocido y rechaza un delete de otro número", async () => {
    const fake = createFakeStore(
      connection({ phoneNumberId: "phone-1", status: "provisioning" }),
    );
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.deleted",
      idempotencyKey: "kapso-delete-1",
      payload: {
        customer: { id: "customer-1" },
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });
    await expect(
      runKapsoProvisioningWorker(
        { now: new Date() },
        fake.store,
        createFakeProvider({
          getPhoneNumber: vi.fn().mockResolvedValue(undefined),
        }),
      ),
    ).resolves.toMatchObject({ processed: 1 });
    expect(fake.getConnection()).toMatchObject({ status: "disconnected" });

    const unknownDelete = createFakeStore(
      connection({ phoneNumberId: "phone-1", status: "provisioning" }),
    );
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.deleted",
      idempotencyKey: "kapso-delete-2",
      payload: {
        customer: { id: "customer-1" },
        phone_number_id: "phone-2",
        project: { id: "project-1" },
      },
      store: unknownDelete.store,
    });
    await expect(
      runKapsoProvisioningWorker(
        { now: new Date() },
        unknownDelete.store,
        createFakeProvider(),
      ),
    ).resolves.toMatchObject({ rejected: 1 });
    expect(unknownDelete.getConnection()).toMatchObject({
      phoneNumberId: "phone-1",
      status: "provisioning",
    });
  });

  it("no desconecta si Kapso todavía reporta el número activo", async () => {
    const fake = createFakeStore(
      connection({ phoneNumberId: "phone-1", status: "ready" }),
    );
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.deleted",
      idempotencyKey: "kapso-stale-delete-1",
      payload: {
        customer: { id: "customer-1" },
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });

    const provider = createFakeProvider();
    await expect(
      runKapsoProvisioningWorker(
        { now: new Date("2026-09-07T12:00:00.000Z") },
        fake.store,
        provider,
      ),
    ).resolves.toMatchObject({ processed: 1 });

    expect(provider.getPhoneNumber).toHaveBeenCalledWith("phone-1");
    expect(fake.getConnection().status).toBe("ready");
  });

  it("cede un delete a un created recibido después para la misma identidad", async () => {
    const fake = createFakeStore(
      connection({ phoneNumberId: "phone-1", status: "pending" }),
    );
    const payload = {
      customer: { id: "customer-1" },
      phone_number_id: "phone-1",
      project: { id: "project-1" },
    };
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.deleted",
      idempotencyKey: "kapso-out-of-order-delete-1",
      payload,
      store: fake.store,
    });
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.created",
      idempotencyKey: "kapso-out-of-order-created-1",
      payload,
      store: fake.store,
    });
    const provider = createFakeProvider();

    await expect(
      runKapsoProvisioningWorker(
        { now: new Date("2026-09-07T12:00:00.000Z") },
        fake.store,
        provider,
      ),
    ).resolves.toMatchObject({ processed: 2 });
    expect(fake.getConnection().status).toBe("provisioning");
    expect(provider.getPhoneNumber).toHaveBeenCalledTimes(1);
  });

  it("reintenta un delete si Kapso no puede revalidar el número", async () => {
    const fake = createFakeStore(
      connection({ phoneNumberId: "phone-1", status: "ready" }),
    );
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.deleted",
      idempotencyKey: "kapso-delete-timeout-1",
      payload: {
        customer: { id: "customer-1" },
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });
    const provider = createFakeProvider({
      getPhoneNumber: vi
        .fn()
        .mockRejectedValue(new KapsoProvisioningProviderError(503, "caído")),
    });

    await expect(
      runKapsoProvisioningWorker(
        { now: new Date("2026-09-07T12:00:00.000Z") },
        fake.store,
        provider,
      ),
    ).resolves.toMatchObject({ retried: 1 });
    expect(fake.getConnection().status).toBe("ready");
  });
});
