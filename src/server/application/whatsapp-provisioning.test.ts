import { describe, expect, it, vi } from "vitest";

import type { KapsoProvisioningStepName } from "~/domain/whatsapp-kapso-provisioning";
import { whatsappCriticalTemplateCatalog } from "~/domain/whatsapp-readiness";

import {
  KapsoProvisioningProviderError,
  KAPSO_PROVISIONING_MAX_ATTEMPTS,
  receiveKapsoWebhook,
  runKapsoProvisioningWorker,
  type KapsoProvisioningConnection,
  type KapsoProvisioningEvent,
  type KapsoProvisioningProvider,
  type KapsoProvisioningStore,
} from "./whatsapp-provisioning";
import type {
  WhatsAppReadinessProvider,
  WhatsAppReadinessRecord,
  WhatsAppReadinessProvisioningStore,
} from "./whatsapp-readiness";
import type { WhatsAppCircuitBreakerStore } from "./whatsapp-circuit-breaker";

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
  const leaseExpiresAt = new Map<string, Date | null>();
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
        leaseExpiresAt: null,
        leaseRecovered: false,
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
          (item.status === "pending" &&
            (item.nextAttemptAt === null || item.nextAttemptAt <= input.now)) ||
          (item.status === "processing" &&
            item.attempts <= KAPSO_PROVISIONING_MAX_ATTEMPTS &&
            (leaseExpiresAt.get(item.id) ?? item.leaseExpiresAt) !== null &&
            (leaseExpiresAt.get(item.id) ?? item.leaseExpiresAt)! <= input.now),
      );
      for (const item of pending) {
        const recoveringLease = item.status === "processing";
        const recoveringAtMaxAttempts =
          recoveringLease && item.attempts >= KAPSO_PROVISIONING_MAX_ATTEMPTS;
        item.status = "processing";
        if (!recoveringAtMaxAttempts) item.attempts += 1;
        item.leaseRecovered = recoveringLease;
        item.leaseToken = `lease-${item.id}-${item.attempts}`;
        item.leaseExpiresAt = new Date(input.now.valueOf() + 600_000);
        leaseExpiresAt.set(item.id, item.leaseExpiresAt);
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
    async pauseForCircuit(input) {
      const item = events.find((candidate) => candidate.id === input.eventId);
      if (item) {
        item.attempts = 0;
        item.status = "pending";
        item.nextAttemptAt = input.pausedAt;
        item.leaseExpiresAt = null;
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
    expireLease: (eventId: string, now = new Date(0)) => {
      leaseExpiresAt.set(eventId, now);
    },
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

function createFakeReadiness(overrides: Partial<WhatsAppReadinessRecord> = {}) {
  const now = new Date("2026-09-07T12:00:00.000Z");
  let state: WhatsAppReadinessRecord = {
    billing: {
      alertThresholdCents: 100,
      chargesSeparated: true,
      consumedCents: 0,
      creditCents: 10_000,
      lastError: null,
      lastSyncedAt: now,
      mode: "partner_managed",
      status: "ready",
    },
    clinicId: "clinic-1",
    connection: {
      businessAccountId: "waba-1",
      clinicId: "clinic-1",
      connectionType: "coexistence",
      createdAt: now,
      customer: "customer-1",
      lastTestAt: null,
      metadata: {
        projectId: "project-1",
        provisioningEventId: "event-1",
        webhookStatus: "ready",
      },
      phoneNumberE164: "+50370000000",
      phoneNumberId: "phone-1",
      provider: "kapso",
      status: "provisioning",
      updatedAt: now,
    },
    e2e: {
      evidence: null,
      evidenceScope: null,
      lastError: null,
      lastTestAt: null,
      status: "pending",
    },
    nextAction: "Sincronizar las plantillas críticas",
    numberEnvironment: "unknown",
    numberHealth: "unknown",
    numberHealthCheckedAt: null,
    phoneNumberWebhook: {
      lastAttemptAt: now,
      lastError: null,
      remoteId: "phone-webhook-1",
      status: "ready",
    },
    projectId: "project-1",
    projectWebhook: {
      lastAttemptAt: now,
      lastError: null,
      remoteId: "project-webhook-1",
      status: "ready",
    },
    provisioningEventId: "event-1",
    reconciliation: {
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      nextAttemptAt: null,
      status: "pending",
    },
    statusReason: "Pendiente de sincronización",
    templates: whatsappCriticalTemplateCatalog.map((template) => ({
      category: template.category,
      kind: template.kind,
      locale: template.locale,
      name: template.name,
      providerTemplateId: `template-${template.kind}`,
      rejectionReason: null,
      status: "APPROVED" as const,
      syncedAt: now,
      variables: [...template.variables],
    })),
    templatesSync: {
      lastError: null,
      lastSyncedAt: now,
      status: "ready",
    },
    technicalStatus: "pending",
    ...overrides,
  };
  const saveForProvisioning = vi.fn<
    WhatsAppReadinessProvisioningStore["saveForProvisioning"]
  >(async (input) => {
    state = { ...input.state, revision: (input.state.revision ?? 0) + 1 };
    return state;
  });
  const syncAlerts = vi.fn<WhatsAppReadinessProvisioningStore["syncAlerts"]>(
    async () => undefined,
  );
  const openAlert = vi.fn<WhatsAppReadinessProvisioningStore["openAlert"]>(
    async () => undefined,
  );
  const store: WhatsAppReadinessProvisioningStore = {
    readForProvisioning: vi.fn(async () => state),
    openAlert,
    saveForProvisioning,
    syncAlerts,
  };
  return {
    getState: () => state,
    openAlert,
    saveForProvisioning,
    store,
    syncAlerts,
  };
}

function createFakeReadinessProvider(
  overrides: Partial<WhatsAppReadinessProvider> = {},
): WhatsAppReadinessProvider {
  const now = new Date("2026-09-07T12:00:00.000Z");
  return {
    getBilling: vi.fn().mockResolvedValue({
      alertThresholdCents: 100,
      chargesSeparated: true,
      consumedCents: 0,
      creditCents: 10_000,
      mode: "partner_managed",
      status: "ready",
    }),
    getNumberHealth: vi.fn().mockResolvedValue({
      checkedAt: now,
      health: "healthy",
    }),
    runE2ETest: vi.fn().mockResolvedValue({
      evidence: "Kapso roundtrip de prueba",
      evidenceScope: "message-roundtrip",
      testedAt: now,
    }),
    syncTemplates: vi.fn().mockResolvedValue({
      numberEnvironment: "production",
      numberHealth: "healthy",
      numberHealthCheckedAt: now,
      syncedAt: now,
      templates: whatsappCriticalTemplateCatalog.map((template) => ({
        category: template.category,
        kind: template.kind,
        locale: template.locale,
        name: template.name,
        providerTemplateId: `template-${template.kind}`,
        rejectionReason: null,
        status: "APPROVED" as const,
        syncedAt: now,
        variables: [...template.variables],
      })),
    }),
    ...overrides,
  };
}

describe("recepción del webhook Kapso", () => {
  it("encola un message.sent de Business App para activar takeover", async () => {
    const fake = createFakeStore();
    const enqueueInbound = vi
      .fn<NonNullable<KapsoProvisioningStore["enqueueInbound"]>>()
      .mockResolvedValue({ accepted: true, eventId: "manual-message-1" });
    const enqueueDeliveryStatus = vi.fn();

    await expect(
      receiveKapsoWebhook({
        eventName: "whatsapp.message.sent",
        idempotencyKey: "kapso-business-app-1",
        payload: {
          conversation: {
            id: "conversation-1",
            phone_number: "50370002222",
            phone_number_id: "phone-1",
          },
          message: {
            from: "50370000000",
            id: "wamid-business-app-1",
            kapso: { direction: "outbound", origin: "business_app" },
            text: { body: "Te atenderemos pronto" },
            to: "50370002222",
            type: "text",
          },
          phone_number_id: "phone-1",
        },
        store: {
          ...fake.store,
          enqueueDeliveryStatus,
          enqueueInbound,
        },
      }),
    ).resolves.toMatchObject({
      accepted: true,
      eventId: "manual-message-1",
    });

    const call = enqueueInbound.mock.calls[0]?.[0];
    expect(call?.idempotencyKey).toBe("kapso-business-app-1");
    expect(call?.message).toMatchObject({
      direction: "outbound",
      eventName: "whatsapp.message.sent",
      origin: "business-app",
    });
    expect(enqueueDeliveryStatus).not.toHaveBeenCalled();
  });

  it("encola los estados de Entrega para reconciliarlos de forma asíncrona", async () => {
    const fake = createFakeStore();
    const enqueueDeliveryStatus = vi
      .fn<NonNullable<KapsoProvisioningStore["enqueueDeliveryStatus"]>>()
      .mockResolvedValue({
        accepted: true,
        eventId: "status-event-1",
      });
    fake.store.enqueueDeliveryStatus = enqueueDeliveryStatus;

    await expect(
      receiveKapsoWebhook({
        eventName: "whatsapp.message.delivered",
        idempotencyKey: "kapso-status-1",
        payload: {
          biz_opaque_callback_data: "appointment-1:24h:contact-1",
          message: { id: "wamid-1" },
          phone_number_id: "phone-1",
        },
        store: fake.store,
      }),
    ).resolves.toEqual({ accepted: true, eventId: "status-event-1" });

    const call = enqueueDeliveryStatus.mock.calls[0]?.[0];
    expect(call?.event.correlationKey).toBe("appointment-1:24h:contact-1");
    expect(call?.event.messageId).toBe("wamid-1");
    expect(call?.event.phoneNumberId).toBe("phone-1");
    expect(call?.event.status).toBe("delivered");
    expect(call?.idempotencyKey).toBe("kapso-status-1");
  });

  it("mantiene un message.sent de cloud_api como estado de Entrega", async () => {
    const fake = createFakeStore();
    const enqueueDeliveryStatus = vi
      .fn<NonNullable<KapsoProvisioningStore["enqueueDeliveryStatus"]>>()
      .mockResolvedValue({ accepted: true, eventId: "status-event-1" });
    fake.store.enqueueDeliveryStatus = enqueueDeliveryStatus;

    await expect(
      receiveKapsoWebhook({
        eventName: "whatsapp.message.sent",
        idempotencyKey: "kapso-status-sent-1",
        payload: {
          message: {
            id: "wamid-cloud-api-1",
            kapso: { direction: "outbound", origin: "cloud_api" },
          },
          phone_number_id: "phone-1",
        },
        store: fake.store,
      }),
    ).resolves.toEqual({ accepted: true, eventId: "status-event-1" });

    expect(enqueueDeliveryStatus).toHaveBeenCalledTimes(1);
  });

  it("enruta cada elemento de un lote sent según su origen", async () => {
    const fake = createFakeStore();
    const enqueueInbound = vi
      .fn<NonNullable<KapsoProvisioningStore["enqueueInbound"]>>()
      .mockResolvedValue({ accepted: true, eventId: "manual-message-1" });
    const enqueueDeliveryStatus = vi
      .fn<NonNullable<KapsoProvisioningStore["enqueueDeliveryStatus"]>>()
      .mockResolvedValue({ accepted: true, eventId: "status-message-1" });

    await expect(
      receiveKapsoWebhook({
        eventName: "whatsapp.message.sent",
        idempotencyKey: "kapso-sent-batch-1",
        payload: {
          batch: true,
          batch_info: { first_sequence: 20, last_sequence: 21 },
          data: [
            {
              conversation: {
                id: "conversation-1",
                phone_number: "50370002222",
                phone_number_id: "phone-1",
              },
              message: {
                from: "50370000000",
                id: "wamid-business-app-batch-1",
                kapso: { direction: "outbound", origin: "business_app" },
                text: { body: "Te atenderemos pronto" },
                to: "50370002222",
                type: "text",
              },
              phone_number_id: "phone-1",
            },
            {
              message: {
                id: "wamid-cloud-api-batch-1",
                kapso: { direction: "outbound", origin: "cloud_api" },
                type: "text",
              },
              phone_number_id: "phone-1",
            },
          ],
        },
        store: {
          ...fake.store,
          enqueueDeliveryStatus,
          enqueueInbound,
        },
      }),
    ).resolves.toMatchObject({
      accepted: true,
      eventIds: ["manual-message-1", "status-message-1"],
    });

    expect(enqueueInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "kapso-sent-batch-1:wamid-business-app-batch-1",
      }),
    );
    expect(enqueueDeliveryStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "kapso-sent-batch-1:wamid-cloud-api-batch-1",
      }),
    );
  });

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
  it("completa readiness después de los webhooks y persiste ready por generación", async () => {
    const fake = createFakeStore();
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.created",
      idempotencyKey: "kapso-readiness-1",
      payload: {
        business_account_id: "waba-1",
        customer: { id: "customer-1" },
        display_phone_number: "+50370000000",
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });
    const readiness = createFakeReadiness();
    const readinessProvider = createFakeReadinessProvider();
    const syncTemplates = vi.spyOn(readinessProvider, "syncTemplates");
    const getBilling = vi.spyOn(readinessProvider, "getBilling");
    const runE2ETest = vi.spyOn(readinessProvider, "runE2ETest");

    await expect(
      runKapsoProvisioningWorker(
        { now: new Date("2026-09-07T12:00:00.000Z") },
        fake.store,
        createFakeProvider(),
        { provider: readinessProvider, store: readiness.store },
      ),
    ).resolves.toMatchObject({ processed: 1 });

    expect(syncTemplates).toHaveBeenCalledWith({
      businessAccountId: "waba-1",
      phoneNumberId: "phone-1",
    });
    expect(getBilling).toHaveBeenCalledWith({
      businessAccountId: "waba-1",
      phoneNumberId: "phone-1",
    });
    expect(runE2ETest).toHaveBeenCalledWith({
      phoneNumberId: "phone-1",
      projectWebhookId: "project-webhook-1",
    });
    expect(readiness.getState()).toMatchObject({
      connection: { status: "ready" },
      technicalStatus: "ready",
    });
    expect(readiness.saveForProvisioning).toHaveBeenCalled();
    expect(readiness.syncAlerts).toHaveBeenLastCalledWith(
      expect.objectContaining({
        access: "provisioning-worker",
        provisioningEventId: "event-1",
      }),
    );
  });

  it("deja una alerta reintentable y no habilita envíos ante un fallo parcial", async () => {
    const fake = createFakeStore();
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.created",
      idempotencyKey: "kapso-readiness-partial-1",
      payload: {
        customer: { id: "customer-1" },
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });
    const readiness = createFakeReadiness();
    const readinessProvider = createFakeReadinessProvider();
    const syncTemplates = vi
      .spyOn(readinessProvider, "syncTemplates")
      .mockRejectedValueOnce(new Error("templates timeout"));

    await expect(
      runKapsoProvisioningWorker(
        { now: new Date("2026-09-07T12:00:00.000Z") },
        fake.store,
        createFakeProvider(),
        { provider: readinessProvider, store: readiness.store },
      ),
    ).resolves.toMatchObject({ retried: 1 });

    expect(readiness.getState()).toMatchObject({
      connection: { status: "degraded" },
      technicalStatus: "degraded",
      templatesSync: { status: "failed", lastError: "templates timeout" },
    });
    const lastAlertSync = readiness.syncAlerts.mock.lastCall?.[0];
    expect(
      lastAlertSync?.gates.some(
        (gate) =>
          gate.code === "templates" &&
          gate.status === "failed" &&
          gate.message.includes("templates timeout"),
      ),
    ).toBe(true);

    const retry = fake.events[0];
    if (!retry) throw new Error("Falta el evento de prueba");
    retry.nextAttemptAt = new Date("2026-09-07T12:00:00.000Z");
    await expect(
      runKapsoProvisioningWorker(
        { now: new Date("2026-09-07T12:00:00.000Z") },
        fake.store,
        createFakeProvider(),
        { provider: readinessProvider, store: readiness.store },
      ),
    ).resolves.toMatchObject({ processed: 1 });
    expect(syncTemplates).toHaveBeenCalledTimes(2);
    expect(readiness.getState()).toMatchObject({
      connection: { status: "ready" },
      technicalStatus: "ready",
    });
  });

  it("abre una alerta de webhooks cuando el provisioning parcial necesita reintento", async () => {
    const fake = createFakeStore();
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.created",
      idempotencyKey: "kapso-webhook-alert-1",
      payload: {
        customer: { id: "customer-1" },
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });
    const readiness = createFakeReadiness();
    const provider = createFakeProvider({
      ensurePhoneNumberWebhook: vi
        .fn()
        .mockRejectedValue(
          new KapsoProvisioningProviderError(503, "Kapso down"),
        ),
    });

    await expect(
      runKapsoProvisioningWorker(
        { now: new Date("2026-09-07T12:00:00.000Z") },
        fake.store,
        provider,
        { provider: createFakeReadinessProvider(), store: readiness.store },
      ),
    ).resolves.toMatchObject({ retried: 1 });

    expect(readiness.openAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        gateCode: "webhooks",
        reason: "Kapso down",
        eventId: "event-1",
      }),
    );
  });

  it("abre inmediatamente el circuito cuando Kapso reporta un webhook pausado", async () => {
    const fake = createFakeStore();
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.created",
      idempotencyKey: "kapso-webhook-paused-1",
      payload: {
        customer: { id: "customer-1" },
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });
    const provider = createFakeProvider({
      ensureProjectWebhook: vi.fn().mockResolvedValue({
        remoteId: "project-webhook-1",
        wasPaused: true,
      }),
    });
    const open = vi.fn().mockResolvedValue({
      status: "open",
    });
    const recordFailure = vi.fn();

    await expect(
      runKapsoProvisioningWorker(
        { now: new Date("2026-09-07T12:00:00.000Z") },
        fake.store,
        provider,
        undefined,
        { open, recordFailure } as unknown as WhatsAppCircuitBreakerStore,
      ),
    ).resolves.toMatchObject({ retried: 1 });

    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        actorKind: "worker",
        cause: "webhook-paused",
        workerKind: "provisioning",
      }),
    );
    expect(recordFailure).not.toHaveBeenCalled();
    expect(fake.events[0]).toMatchObject({ attempts: 0, status: "pending" });
  });

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
    expect(fake.getConnection().metadata.provisioningEventId).toBe("event-1");
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

  it("limita la provisión a tres intentos y abre el circuito sin perder el evento", async () => {
    const fake = createFakeStore();
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.created",
      idempotencyKey: "kapso-three-attempts-1",
      payload: {
        customer: { id: "customer-1" },
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });
    const provider = createFakeProvider({
      ensureProjectWebhook: vi
        .fn()
        .mockRejectedValue(
          new KapsoProvisioningProviderError(503, "Kapso down"),
        ),
    });
    const recordFailure = vi
      .fn<WhatsAppCircuitBreakerStore["recordFailure"]>()
      .mockResolvedValueOnce({
        opened: false,
        state: {} as Awaited<ReturnType<WhatsAppCircuitBreakerStore["read"]>>,
      })
      .mockResolvedValueOnce({
        opened: false,
        state: {} as Awaited<ReturnType<WhatsAppCircuitBreakerStore["read"]>>,
      })
      .mockResolvedValueOnce({
        opened: true,
        state: {} as Awaited<ReturnType<WhatsAppCircuitBreakerStore["read"]>>,
      });
    const circuitBreaker = {
      recordFailure,
    } as unknown as WhatsAppCircuitBreakerStore;
    const initial = new Date("2026-09-07T12:00:00.000Z");

    await expect(
      runKapsoProvisioningWorker(
        { now: initial },
        fake.store,
        provider,
        undefined,
        circuitBreaker,
      ),
    ).resolves.toMatchObject({ retried: 1 });
    expect(fake.events[0]?.nextAttemptAt).toEqual(
      new Date(initial.valueOf() + 10_000),
    );

    const secondAttempt = fake.events[0];
    if (!secondAttempt) throw new Error("Falta el evento de prueba");
    secondAttempt.nextAttemptAt = new Date(initial.valueOf() + 10_000);
    await expect(
      runKapsoProvisioningWorker(
        { now: secondAttempt.nextAttemptAt },
        fake.store,
        provider,
        undefined,
        circuitBreaker,
      ),
    ).resolves.toMatchObject({ retried: 1 });
    expect(fake.events[0]?.nextAttemptAt).toEqual(
      new Date(initial.valueOf() + 50_000),
    );

    const thirdAttempt = fake.events[0];
    if (!thirdAttempt) throw new Error("Falta el evento de prueba");
    thirdAttempt.nextAttemptAt = new Date(initial.valueOf() + 50_000);
    await expect(
      runKapsoProvisioningWorker(
        { now: thirdAttempt.nextAttemptAt },
        fake.store,
        provider,
        undefined,
        circuitBreaker,
      ),
    ).resolves.toMatchObject({ retried: 1 });
    expect(provider.ensureProjectWebhook).toHaveBeenCalledTimes(3);
    expect(recordFailure).toHaveBeenCalledTimes(3);
    expect(fake.events[0]).toMatchObject({ attempts: 0, status: "pending" });
  });

  it("recupera un lease abandonado en el tercer intento y lo resuelve sin repetir Kapso", async () => {
    const fake = createFakeStore();
    await receiveKapsoWebhook({
      eventName: "whatsapp.phone_number.created",
      idempotencyKey: "kapso-abandoned-third-attempt-1",
      payload: {
        customer: { id: "customer-1" },
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
      store: fake.store,
    });
    const event = fake.events[0];
    if (event === undefined) throw new Error("Falta el evento abandonado");
    event.status = "processing";
    event.attempts = KAPSO_PROVISIONING_MAX_ATTEMPTS;
    event.leaseToken = "lease-abandoned";
    fake.expireLease(event.id);

    const provider = createFakeProvider();
    const recordFailure = vi
      .fn<WhatsAppCircuitBreakerStore["recordFailure"]>()
      .mockResolvedValue({
        opened: false,
        state: {} as Awaited<ReturnType<WhatsAppCircuitBreakerStore["read"]>>,
      });

    await expect(
      runKapsoProvisioningWorker(
        { now: new Date("2026-09-07T12:00:00.000Z") },
        fake.store,
        provider,
        undefined,
        { recordFailure } as unknown as WhatsAppCircuitBreakerStore,
      ),
    ).resolves.toMatchObject({ claimed: 1, rejected: 1 });
    expect(provider.ensureProjectWebhook).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(event.status).toBe("rejected");
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
