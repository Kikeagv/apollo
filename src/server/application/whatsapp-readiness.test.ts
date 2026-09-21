import { describe, expect, it, vi } from "vitest";

import type { WhatsAppConnection } from "~/domain/whatsapp-connection";
import {
  whatsappCriticalTemplateCatalog,
  type WhatsAppTemplateSnapshot,
} from "~/domain/whatsapp-readiness";

import {
  getWhatsAppReadiness,
  retryWhatsAppReadiness,
  runWhatsAppReadinessReconciliation,
  WhatsAppReadinessConflictError,
  type WhatsAppReadinessProvider,
  type WhatsAppReadinessReconciliationProvider,
  type WhatsAppReadinessRecord,
  type WhatsAppReadinessReconciliationStore,
  type WhatsAppReadinessStore,
} from "./whatsapp-readiness";

const now = new Date("2026-09-07T12:00:00.000Z");

function connection(
  overrides: Partial<WhatsAppConnection> = {},
): WhatsAppConnection {
  return {
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
    ...overrides,
  };
}

function approvedTemplates(
  overrides: Partial<WhatsAppTemplateSnapshot> = {},
): WhatsAppTemplateSnapshot[] {
  return whatsappCriticalTemplateCatalog.map((template) => ({
    category: template.category,
    kind: template.kind,
    locale: template.locale,
    name: template.name,
    providerTemplateId: `kapso-${template.kind}`,
    rejectionReason: null,
    status: "APPROVED" as const,
    syncedAt: now,
    variables: [...template.variables],
    ...(overrides.kind === undefined || overrides.kind === template.kind
      ? overrides
      : {}),
  }));
}

function record(
  overrides: Partial<WhatsAppReadinessRecord> = {},
): WhatsAppReadinessRecord {
  return {
    billing: {
      alertThresholdCents: null,
      chargesSeparated: false,
      consumedCents: 0,
      creditCents: 0,
      lastError: null,
      lastSyncedAt: null,
      mode: "unknown",
      status: "pending",
    },
    clinicId: "clinic-1",
    connection: connection(),
    e2e: {
      evidence: null,
      evidenceScope: null,
      lastError: null,
      lastTestAt: null,
      status: "pending",
    },
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
    templates: [],
    templatesSync: {
      lastError: null,
      lastSyncedAt: null,
      status: "pending",
    },
    technicalStatus: "pending",
    nextAction: "Sincronizar las plantillas críticas",
    ...overrides,
  };
}

function fakeStore(initial = record()) {
  let current = initial;
  const read = vi.fn<WhatsAppReadinessStore["read"]>(async () => current);
  const save = vi.fn<WhatsAppReadinessStore["save"]>(async ({ state }) => {
    current = { ...state, revision: (state.revision ?? 0) + 1 };
    return current;
  });
  const retryWebhooks = vi.fn<
    NonNullable<WhatsAppReadinessStore["retryWebhooks"]>
  >(async () => undefined);
  const templateProvisioningLockCalls: string[] = [];
  const withTemplateProvisioningLock = async <T>({
    businessAccountId,
    operation,
  }: {
    businessAccountId: string;
    operation: () => Promise<T>;
  }) => {
    templateProvisioningLockCalls.push(businessAccountId);
    return operation();
  };
  const store: WhatsAppReadinessStore = {
    read,
    retryWebhooks,
    save,
    withTemplateProvisioningLock,
  };
  return {
    getState: () => current,
    read,
    retryWebhooks,
    save,
    store,
    templateProvisioningLockCalls,
    withTemplateProvisioningLock,
  };
}

function fakeProvider(
  overrides: Partial<WhatsAppReadinessProvider> = {},
): WhatsAppReadinessProvider {
  return {
    getBilling: vi.fn().mockResolvedValue({
      alertThresholdCents: 1_000,
      chargesSeparated: true,
      consumedCents: 2_000,
      creditCents: 10_000,
      mode: "partner_managed",
      status: "ready",
    }),
    getNumberHealth: vi.fn().mockResolvedValue({
      checkedAt: now,
      health: "healthy",
    }),
    runE2ETest: vi.fn().mockResolvedValue({
      evidence: "Kapso respondió correctamente",
      evidenceScope: "message-roundtrip",
      testedAt: now,
    }),
    syncTemplates: vi.fn().mockResolvedValue({
      numberHealth: "healthy",
      numberHealthCheckedAt: now,
      numberEnvironment: "production",
      syncedAt: now,
      templates: approvedTemplates(),
    }),
    ...overrides,
  };
}

function fakeReconciliationStore(initial = record()) {
  let current = initial;
  let attempts = 1;
  const leaseToken = "reconciliation-lease-1";
  const claimDueReconciliations = vi.fn<
    WhatsAppReadinessReconciliationStore["claimDueReconciliations"]
  >(async () => [
    {
      attempts,
      clinicId: current.clinicId,
      expectedGeneration: {
        businessAccountId: current.connection?.businessAccountId ?? null,
        phoneNumberId: current.connection?.phoneNumberId ?? null,
        projectId: current.projectId,
        provisioningEventId: current.provisioningEventId,
      },
      claimedGeneration: {
        businessAccountId: current.connection?.businessAccountId ?? null,
        phoneNumberId: current.connection?.phoneNumberId ?? null,
        projectId: current.projectId,
        provisioningEventId: current.provisioningEventId,
      },
      leaseToken,
    },
  ]);
  const readForReconciliation = vi.fn<
    WhatsAppReadinessReconciliationStore["readForReconciliation"]
  >(async () => current);
  const saveForReconciliation = vi.fn<
    WhatsAppReadinessReconciliationStore["saveForReconciliation"]
  >(async ({ state }) => {
    current = { ...state, revision: (state.revision ?? 0) + 1 };
    return current;
  });
  const completeReconciliation = vi.fn<
    WhatsAppReadinessReconciliationStore["completeReconciliation"]
  >(
    async ({
      attempts: completedAttempts,
      lastError,
      nextAttemptAt,
      status,
    }) => {
      attempts = completedAttempts ?? attempts;
      current = {
        ...current,
        reconciliation: {
          ...current.reconciliation,
          attempts,
          lastError,
          nextAttemptAt,
          status,
        },
      };
    },
  );
  const syncAlerts = vi.fn<
    NonNullable<WhatsAppReadinessReconciliationStore["syncAlerts"]>
  >(async () => undefined);
  const withTemplateProvisioningLock = async <T>({
    operation,
  }: {
    businessAccountId: string;
    operation: () => Promise<T>;
  }) => operation();
  const store: WhatsAppReadinessReconciliationStore = {
    claimDueReconciliations,
    completeReconciliation,
    readForReconciliation,
    saveForReconciliation,
    syncAlerts,
    withTemplateProvisioningLock,
  };
  return {
    claimDueReconciliations,
    completeReconciliation,
    getState: () => current,
    readForReconciliation,
    saveForReconciliation,
    store,
    syncAlerts,
    setAttempts: (nextAttempts: number) => {
      attempts = nextAttempts;
    },
  };
}

function fakeReconciliationProvider(
  overrides: Partial<WhatsAppReadinessReconciliationProvider> = {},
): WhatsAppReadinessReconciliationProvider {
  return {
    ...fakeProvider(),
    ensurePhoneNumberWebhook: vi
      .fn()
      .mockResolvedValue({ remoteId: "phone-webhook-reconciled" }),
    ensureProjectWebhook: vi
      .fn()
      .mockResolvedValue({ remoteId: "project-webhook-reconciled" }),
    ...overrides,
  };
}

describe("caso de uso de readiness técnico de WhatsApp", () => {
  it("lee el estado dentro del acceso solicitado y recalcula los gates", async () => {
    const fake = fakeStore(
      record({
        templates: approvedTemplates(),
        templatesSync: {
          lastError: null,
          lastSyncedAt: now,
          status: "ready",
        },
      }),
    );

    const result = await getWhatsAppReadiness(
      {
        access: "clinic-owner",
        actorIdentityId: "owner-1",
        clinicId: "clinic-1",
      },
      fake.store,
    );

    expect(result.readiness.status).toBe("pending");
    expect(fake.read).toHaveBeenCalledWith({
      access: "clinic-owner",
      actorIdentityId: "owner-1",
      clinicId: "clinic-1",
    });
  });

  it("expone la salud de crédito usando el primer umbral crítico", async () => {
    const fake = fakeStore(
      record({
        billing: {
          alertThresholdCents: 1_000,
          chargesSeparated: true,
          consumedCents: 2_000,
          creditCents: 800,
          creditLimitCents: 10_000,
          estimatedDailyConsumptionCents: 100,
          lastError: null,
          lastSyncedAt: now,
          mode: "partner_managed",
          status: "ready",
        },
      }),
    );

    const result = await getWhatsAppReadiness(
      {
        access: "superadmin",
        actorIdentityId: "superadmin-1",
        clinicId: "clinic-1",
      },
      fake.store,
    );

    expect(result.billingHealth).toEqual({
      autonomyDays: 8,
      balancePercent: 8,
      level: "critical",
      reason: "balance",
    });
  });

  it("no reactiva automáticamente una Conexión bloqueada aunque los gates estén completos", async () => {
    const fake = fakeStore(
      record({
        connection: connection({ status: "blocked" }),
        templates: approvedTemplates(),
        templatesSync: {
          lastError: null,
          lastSyncedAt: now,
          status: "ready",
        },
        numberEnvironment: "production",
        billing: {
          alertThresholdCents: 1_000,
          chargesSeparated: true,
          consumedCents: 2_000,
          creditCents: 10_000,
          lastError: null,
          lastSyncedAt: now,
          mode: "partner_managed",
          status: "ready",
        },
        e2e: {
          evidence: "Kapso respondió correctamente",
          evidenceScope: "message-roundtrip",
          lastError: null,
          lastTestAt: now,
          status: "passed",
        },
      }),
    );

    const result = await getWhatsAppReadiness(
      {
        access: "superadmin",
        actorIdentityId: "superadmin-1",
        clinicId: "clinic-1",
      },
      fake.store,
    );

    expect(result.readiness.status).toBe("blocked");
    expect(result.connection?.status).toBe("blocked");
  });

  it("solo reactiva una Conexión bloqueada mediante la acción explícita del superadmin", async () => {
    const fake = fakeStore(
      record({
        billing: {
          alertThresholdCents: 1_000,
          chargesSeparated: true,
          consumedCents: 2_000,
          creditCents: 10_000,
          lastError: null,
          lastSyncedAt: now,
          mode: "partner_managed",
          status: "ready",
        },
        connection: connection({ status: "blocked" }),
        e2e: {
          evidence: "Kapso respondió correctamente",
          evidenceScope: "message-roundtrip",
          lastError: null,
          lastTestAt: now,
          status: "passed",
        },
        numberEnvironment: "production",
        numberHealth: "healthy",
        numberHealthCheckedAt: now,
        templates: approvedTemplates(),
        templatesSync: {
          lastError: null,
          lastSyncedAt: now,
          status: "ready",
        },
      }),
    );
    const syncTemplates = vi.fn<WhatsAppReadinessProvider["syncTemplates"]>();
    const getBilling = vi.fn<WhatsAppReadinessProvider["getBilling"]>();
    const runE2ETest = vi.fn<WhatsAppReadinessProvider["runE2ETest"]>();
    const provider = fakeProvider({ syncTemplates, getBilling, runE2ETest });

    const result = await retryWhatsAppReadiness(
      {
        action: "reactivate",
        actorIdentityId: "superadmin-1",
        clinicId: "clinic-1",
      },
      { now, provider, store: fake.store },
    );

    expect(result.readiness.status).toBe("ready");
    expect(result.connection?.status).toBe("ready");
    expect(syncTemplates).not.toHaveBeenCalled();
    expect(getBilling).not.toHaveBeenCalled();
    expect(runE2ETest).not.toHaveBeenCalled();
  });

  it("permite recuperar una Conexión degradada solo mediante reactivación explícita", async () => {
    const fake = fakeStore(
      record({
        billing: {
          alertThresholdCents: 1_000,
          chargesSeparated: true,
          consumedCents: 2_000,
          creditCents: 10_000,
          lastError: null,
          lastSyncedAt: now,
          mode: "partner_managed",
          status: "ready",
        },
        connection: connection({ status: "degraded" }),
        e2e: {
          evidence: "Kapso respondió correctamente",
          evidenceScope: "message-roundtrip",
          lastError: null,
          lastTestAt: now,
          status: "passed",
        },
        numberEnvironment: "production",
        numberHealth: "healthy",
        numberHealthCheckedAt: now,
        templates: approvedTemplates(),
        templatesSync: {
          lastError: null,
          lastSyncedAt: now,
          status: "ready",
        },
      }),
    );

    const getBilling = vi.fn<WhatsAppReadinessProvider["getBilling"]>();
    const runE2ETest = vi.fn<WhatsAppReadinessProvider["runE2ETest"]>();
    const syncTemplates = vi.fn<WhatsAppReadinessProvider["syncTemplates"]>();
    const provider = fakeProvider({ getBilling, runE2ETest, syncTemplates });
    const result = await retryWhatsAppReadiness(
      {
        action: "reactivate",
        actorIdentityId: "superadmin-1",
        clinicId: "clinic-1",
      },
      { now, provider, store: fake.store },
    );

    expect(result.readiness.status).toBe("ready");
    expect(result.connection?.status).toBe("ready");
    expect(getBilling).not.toHaveBeenCalled();
    expect(runE2ETest).not.toHaveBeenCalled();
    expect(syncTemplates).not.toHaveBeenCalled();
  });

  it("ejecuta plantillas, billing y E2E por separado y solo termina en ready al completar el último gate", async () => {
    const fake = fakeStore();
    const syncTemplates = vi
      .fn<WhatsAppReadinessProvider["syncTemplates"]>()
      .mockResolvedValue({
        numberHealth: "healthy",
        numberHealthCheckedAt: now,
        numberEnvironment: "production",
        syncedAt: now,
        templates: approvedTemplates(),
      });
    const getBilling = vi
      .fn<WhatsAppReadinessProvider["getBilling"]>()
      .mockResolvedValue({
        alertThresholdCents: 1_000,
        chargesSeparated: true,
        consumedCents: 2_000,
        creditCents: 10_000,
        mode: "partner_managed",
        status: "ready",
      });
    const runE2ETest = vi
      .fn<WhatsAppReadinessProvider["runE2ETest"]>()
      .mockResolvedValue({
        evidence: "Kapso respondió correctamente",
        evidenceScope: "message-roundtrip",
        testedAt: now,
      });
    const provider = fakeProvider({ syncTemplates, getBilling, runE2ETest });
    const dependencies = { now, provider, store: fake.store };

    const afterTemplates = await retryWhatsAppReadiness(
      {
        action: "templates",
        actorIdentityId: "superadmin-1",
        clinicId: "clinic-1",
      },
      dependencies,
    );
    expect(afterTemplates.readiness.status).toBe("pending");
    expect(syncTemplates).toHaveBeenCalledOnce();
    expect(fake.templateProvisioningLockCalls).toEqual(["waba-1"]);
    expect(getBilling).not.toHaveBeenCalled();
    expect(runE2ETest).not.toHaveBeenCalled();

    const afterBilling = await retryWhatsAppReadiness(
      {
        action: "billing",
        actorIdentityId: "superadmin-1",
        clinicId: "clinic-1",
      },
      dependencies,
    );
    expect(afterBilling.readiness.status).toBe("pending");
    expect(getBilling).toHaveBeenCalledOnce();
    expect(runE2ETest).not.toHaveBeenCalled();

    const afterE2E = await retryWhatsAppReadiness(
      {
        action: "e2e",
        actorIdentityId: "superadmin-1",
        clinicId: "clinic-1",
      },
      dependencies,
    );
    expect(afterE2E.readiness.status).toBe("ready");
    expect(afterE2E.connection?.status).toBe("ready");
    expect(afterE2E.e2e.evidence).toContain("Kapso");
    expect(runE2ETest).toHaveBeenCalledWith({
      phoneNumberId: "phone-1",
      projectWebhookId: "project-webhook-1",
    });
  });

  it("mantiene el rechazo de un WABA aislado de otra Clínica", async () => {
    const first = fakeStore(record());
    const second = fakeStore(
      record({
        clinicId: "clinic-2",
        connection: connection({
          businessAccountId: "waba-2",
          clinicId: "clinic-2",
          phoneNumberId: "phone-2",
        }),
      }),
    );
    const syncTemplates = vi.fn(
      async ({ businessAccountId }: { businessAccountId: string }) => ({
        numberHealth: "healthy" as const,
        numberHealthCheckedAt: now,
        numberEnvironment: "production" as const,
        syncedAt: now,
        templates: approvedTemplates({
          kind: "confirmation",
          provisioningStatus:
            businessAccountId === "waba-1" ? ("rejected" as const) : undefined,
          rejectionReason:
            businessAccountId === "waba-1" ? "Contenido no aprobado" : null,
          status: businessAccountId === "waba-1" ? "REJECTED" : "APPROVED",
        }),
      }),
    );
    const provider = fakeProvider({ syncTemplates });

    const firstResult = await retryWhatsAppReadiness(
      {
        action: "templates",
        actorIdentityId: "superadmin-1",
        clinicId: "clinic-1",
      },
      { now, provider, store: first.store },
    );
    const secondResult = await retryWhatsAppReadiness(
      {
        action: "templates",
        actorIdentityId: "superadmin-1",
        clinicId: "clinic-2",
      },
      { now, provider, store: second.store },
    );

    expect(
      firstResult.templates.find(
        (template) => template.kind === "confirmation",
      ),
    ).toMatchObject({
      provisioningStatus: "rejected",
      status: "REJECTED",
    });
    expect(
      firstResult.readiness.gates.find((gate) => gate.code === "templates"),
    ).toMatchObject({ status: "blocked" });
    expect(
      secondResult.readiness.gates.find((gate) => gate.code === "templates"),
    ).toMatchObject({ status: "ready" });
    expect(syncTemplates).toHaveBeenNthCalledWith(1, {
      businessAccountId: "waba-1",
      phoneNumberId: "phone-1",
    });
    expect(syncTemplates).toHaveBeenNthCalledWith(2, {
      businessAccountId: "waba-2",
      phoneNumberId: "phone-2",
    });
  });

  it("reencola los webhooks sin ejecutar gates de readiness desde la UI de operaciones", async () => {
    const fake = fakeStore();
    const syncTemplates = vi.fn<WhatsAppReadinessProvider["syncTemplates"]>();
    const getBilling = vi.fn<WhatsAppReadinessProvider["getBilling"]>();
    const runE2ETest = vi.fn<WhatsAppReadinessProvider["runE2ETest"]>();
    const provider = fakeProvider({ syncTemplates, getBilling, runE2ETest });

    const result = await retryWhatsAppReadiness(
      {
        action: "webhooks",
        actorIdentityId: "superadmin-1",
        clinicId: "clinic-1",
      },
      { now, provider, store: fake.store },
    );

    expect(fake.retryWebhooks).toHaveBeenCalledWith({
      actorIdentityId: "superadmin-1",
      clinicId: "clinic-1",
      eventId: "event-1",
      expectedGeneration: {
        businessAccountId: "waba-1",
        phoneNumberId: "phone-1",
        projectId: "project-1",
        provisioningEventId: "event-1",
      },
      now,
    });
    expect(syncTemplates).not.toHaveBeenCalled();
    expect(getBilling).not.toHaveBeenCalled();
    expect(runE2ETest).not.toHaveBeenCalled();
    expect(result.readiness.status).toBe("pending");
  });

  it("no sincroniza números sandbox y deja evidencia del bloqueo sin declarar ready", async () => {
    const fake = fakeStore();
    const provider = fakeProvider({
      syncTemplates: vi.fn().mockResolvedValue({
        numberHealth: "unknown",
        numberHealthCheckedAt: null,
        numberEnvironment: "sandbox",
        syncedAt: now,
        templates: [],
      }),
    });

    await expect(
      retryWhatsAppReadiness(
        {
          action: "templates",
          actorIdentityId: "superadmin-1",
          clinicId: "clinic-1",
        },
        { now, provider, store: fake.store },
      ),
    ).rejects.toThrow("números sandbox");
    expect(fake.getState().numberEnvironment).toBe("sandbox");
    expect(fake.getState().connection?.status).toBe("blocked");
    expect(fake.getState().templates).toEqual([]);
  });

  it("no persiste un estado de readiness si todavía no existe una Conexión", async () => {
    const fake = fakeStore(record({ connection: null }));

    await expect(
      retryWhatsAppReadiness(
        {
          action: "templates",
          actorIdentityId: "superadmin-1",
          clinicId: "clinic-1",
        },
        { now, provider: fakeProvider(), store: fake.store },
      ),
    ).rejects.toThrow("Conexión Kapso");
    expect(fake.save).not.toHaveBeenCalled();
  });

  it("conserva el estado fallido y permite reintentar una llamada externa", async () => {
    const fake = fakeStore();
    const getBilling = vi
      .fn<WhatsAppReadinessProvider["getBilling"]>()
      .mockRejectedValueOnce(new Error("Kapso timeout"))
      .mockResolvedValueOnce({
        alertThresholdCents: 1_000,
        chargesSeparated: true,
        consumedCents: 0,
        creditCents: 10_000,
        mode: "partner_managed",
        status: "ready",
      });
    const provider = fakeProvider({ getBilling });
    const input = {
      action: "billing" as const,
      actorIdentityId: "superadmin-1",
      clinicId: "clinic-1",
    };

    await expect(
      retryWhatsAppReadiness(input, { now, provider, store: fake.store }),
    ).rejects.toThrow("Kapso timeout");
    expect(fake.getState().billing.status).toBe("failed");
    expect(fake.getState().connection?.status).toBe("degraded");

    await retryWhatsAppReadiness(input, { now, provider, store: fake.store });

    expect(getBilling).toHaveBeenCalledTimes(2);
    expect(fake.getState().billing.status).toBe("ready");
    expect(fake.getState().connection?.status).toBe("degraded");
  });

  it("conserva el bloqueo cuando la generación cambia durante la reconciliación", async () => {
    const fake = fakeStore();
    let currentProvisioningEventId = "event-2";
    const save = vi.fn(
      async (input: Parameters<WhatsAppReadinessStore["save"]>[0]) => {
        const expectedGeneration = (
          input as Parameters<WhatsAppReadinessStore["save"]>[0] & {
            expectedGeneration?: { provisioningEventId: string | null };
          }
        ).expectedGeneration;
        if (
          expectedGeneration?.provisioningEventId !== currentProvisioningEventId
        ) {
          throw new WhatsAppReadinessConflictError();
        }
        return fake.getState();
      },
    );
    const provider = fakeProvider({
      getBilling: vi.fn().mockImplementation(async () => {
        currentProvisioningEventId = "event-2";
        return {
          alertThresholdCents: 1_000,
          chargesSeparated: true,
          consumedCents: 2_000,
          creditCents: 10_000,
          mode: "partner_managed" as const,
          status: "ready" as const,
        };
      }),
    });

    await expect(
      retryWhatsAppReadiness(
        {
          action: "billing",
          actorIdentityId: "superadmin-1",
          clinicId: "clinic-1",
        },
        {
          now,
          provider,
          store: { ...fake.store, save },
        },
      ),
    ).rejects.toBeInstanceOf(WhatsAppReadinessConflictError);

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedGeneration: {
          businessAccountId: "waba-1",
          phoneNumberId: "phone-1",
          projectId: "project-1",
          provisioningEventId: "event-1",
        },
      }),
    );
    expect(fake.getState().billing.status).toBe("pending");
  });

  it("reconcilia los gates completos y programa la siguiente comprobación de salud", async () => {
    const fake = fakeReconciliationStore();
    const provider = fakeReconciliationProvider();
    const providerMocks = provider as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    const ensureProjectWebhook = providerMocks.ensureProjectWebhook;
    const ensurePhoneNumberWebhook = providerMocks.ensurePhoneNumberWebhook;
    const syncTemplates = providerMocks.syncTemplates;
    const providerGetBilling = providerMocks.getBilling;
    const runE2ETest = providerMocks.runE2ETest;

    const result = await runWhatsAppReadinessReconciliation(
      { now },
      { provider, store: fake.store },
    );

    expect(result).toEqual({
      blocked: 0,
      claimed: 1,
      pending: 0,
      retried: 0,
      succeeded: 1,
    });
    expect(ensureProjectWebhook).toHaveBeenCalledOnce();
    expect(ensurePhoneNumberWebhook).toHaveBeenCalledWith("phone-1");
    expect(syncTemplates).toHaveBeenCalledOnce();
    expect(providerGetBilling).toHaveBeenCalledOnce();
    expect(runE2ETest).toHaveBeenCalledOnce();
    expect(fake.completeReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        nextAttemptAt: new Date("2026-09-07T12:05:00.000Z"),
        status: "succeeded",
      }),
    );
    expect(fake.getState().connection?.status).toBe("ready");
  });

  it("acepta la recuperación idempotente de un webhook pausado", async () => {
    const fake = fakeReconciliationStore();
    const provider = fakeReconciliationProvider({
      ensurePhoneNumberWebhook: vi
        .fn()
        .mockResolvedValue({
          remoteId: "phone-webhook-recovered",
          wasPaused: true,
        }),
      ensureProjectWebhook: vi
        .fn()
        .mockResolvedValue({
          remoteId: "project-webhook-recovered",
          wasPaused: true,
        }),
    });

    const result = await runWhatsAppReadinessReconciliation(
      { now },
      { provider, store: fake.store },
    );

    expect(result.succeeded).toBe(1);
    expect(fake.getState().reconciliation.status).toBe("succeeded");
  });

  it("aplica backoff y alerta después del máximo de fallos del proveedor", async () => {
    const fake = fakeReconciliationStore();
    const getBilling = vi
      .fn<WhatsAppReadinessProvider["getBilling"]>()
      .mockRejectedValue(new Error("Kapso timeout"));
    const provider = fakeReconciliationProvider({ getBilling });

    await runWhatsAppReadinessReconciliation(
      { now },
      { provider, store: fake.store },
    );
    expect(fake.completeReconciliation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        nextAttemptAt: new Date("2026-09-07T12:00:10.000Z"),
        status: "pending",
      }),
    );
    expect(fake.syncAlerts).toHaveBeenCalled();
  });

  it("marca bloqueada una reconciliación que agota sus intentos", async () => {
    const fake = fakeReconciliationStore();
    fake.setAttempts(3);
    const provider = fakeReconciliationProvider({
      getBilling: vi
        .fn<WhatsAppReadinessProvider["getBilling"]>()
        .mockRejectedValue(new Error("Kapso timeout")),
    });

    await runWhatsAppReadinessReconciliation(
      { now },
      { provider, store: fake.store },
    );
    expect(fake.completeReconciliation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastError: "Kapso timeout",
        nextAttemptAt: null,
        status: "blocked",
      }),
    );
    expect(fake.getState().reconciliation.status).toBe("blocked");
  });

  it("vuelve a avanzar automáticamente cuando Kapso aprueba una plantilla pendiente", async () => {
    const fake = fakeReconciliationStore();
    const syncTemplates = vi
      .fn<WhatsAppReadinessProvider["syncTemplates"]>()
      .mockResolvedValueOnce({
        numberHealth: "healthy",
        numberHealthCheckedAt: now,
        numberEnvironment: "production",
        syncedAt: now,
        templates: approvedTemplates({
          provisioningStatus: "in_review",
          status: "PENDING",
        }),
      })
      .mockResolvedValueOnce({
        numberHealth: "healthy",
        numberHealthCheckedAt: now,
        numberEnvironment: "production",
        syncedAt: now,
        templates: approvedTemplates(),
      });
    const provider = fakeReconciliationProvider({ syncTemplates });
    const providerMocks = provider as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    const providerGetBilling = providerMocks.getBilling;
    const runE2ETest = providerMocks.runE2ETest;

    await runWhatsAppReadinessReconciliation(
      { now },
      { provider, store: fake.store },
    );
    expect(fake.getState().reconciliation.status).toBe("pending");
    expect(providerGetBilling).not.toHaveBeenCalled();

    await runWhatsAppReadinessReconciliation(
      { now: new Date("2026-09-07T12:05:00.000Z") },
      { provider, store: fake.store },
    );
    expect(providerGetBilling).toHaveBeenCalledOnce();
    expect(runE2ETest).toHaveBeenCalledOnce();
    expect(fake.getState().reconciliation.status).toBe("succeeded");
  });

  it("mantiene pendiente una asociación sin phone_number_id en lugar de bloquearla", async () => {
    const fake = fakeReconciliationStore(
      record({
        connection: connection({ phoneNumberId: null }),
      }),
    );
    const provider = fakeReconciliationProvider();
    const providerMocks = provider as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;

    await runWhatsAppReadinessReconciliation(
      { now },
      { provider, store: fake.store },
    );
    const ensureProjectWebhook = providerMocks.ensureProjectWebhook;
    const getNumberHealth = providerMocks.getNumberHealth;

    expect(ensureProjectWebhook).not.toHaveBeenCalled();
    expect(getNumberHealth).not.toHaveBeenCalled();
    expect(fake.getState().reconciliation.status).toBe("pending");
    expect(fake.getState().reconciliation.nextAttemptAt).toEqual(
      new Date("2026-09-07T12:05:00.000Z"),
    );
  });

  it("recupera la asociación de un evento perdido sin repetir Embedded Signup", async () => {
    const fake = fakeReconciliationStore(
      record({
        connection: connection({ phoneNumberId: null }),
      }),
    );
    const provider = fakeReconciliationProvider({
      listPhoneNumbers: vi.fn().mockResolvedValue([
        {
          businessAccountId: "waba-1",
          customerId: "customer-1",
          displayPhoneE164: "+50370000000",
          phoneNumberId: "phone-1",
        },
      ]),
    });

    await runWhatsAppReadinessReconciliation(
      { now },
      { provider, store: fake.store },
    );
    const providerMocks = provider as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    const ensureProjectWebhook = providerMocks.ensureProjectWebhook;
    const listPhoneNumbers = providerMocks.listPhoneNumbers;

    expect(listPhoneNumbers).toHaveBeenCalledWith("customer-1");
    expect(fake.getState().connection?.phoneNumberId).toBe("phone-1");
    expect(ensureProjectWebhook).toHaveBeenCalledOnce();
    expect(fake.getState().reconciliation.status).toBe("succeeded");
  });
});
