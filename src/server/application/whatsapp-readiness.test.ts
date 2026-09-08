import { describe, expect, it, vi } from "vitest";

import type { WhatsAppConnection } from "~/domain/whatsapp-connection";
import {
  whatsappCriticalTemplateCatalog,
  type WhatsAppTemplateSnapshot,
} from "~/domain/whatsapp-readiness";

import {
  getWhatsAppReadiness,
  retryWhatsAppReadiness,
  type WhatsAppReadinessProvider,
  type WhatsAppReadinessRecord,
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
    metadata: { projectId: "project-1", webhookStatus: "ready" },
    phoneNumberE164: "+50370000000",
    phoneNumberId: "phone-1",
    provider: "kapso",
    status: "provisioning",
    updatedAt: now,
    ...overrides,
  };
}

function approvedTemplates(): WhatsAppTemplateSnapshot[] {
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
  });
  const store: WhatsAppReadinessStore = {
    read,
    save,
  };
  return { getState: () => current, read, save, store };
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
});
