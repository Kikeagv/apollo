import { describe, expect, it, vi } from "vitest";

import type { WhatsAppSetupLink } from "~/domain/whatsapp-setup-link";
import type {
  KapsoWhatsAppOnboardingSnapshot,
  KapsoWhatsAppOnboardingStore,
} from "./kapso-onboarding";
import { getKapsoWhatsAppOnboarding } from "./kapso-onboarding";
import { manageKapsoWhatsAppSetupLink } from "./whatsapp-setup-links";
import type {
  KapsoOnboardingProvider,
  KapsoSetupLink,
} from "~/server/whatsapp/kapso-onboarding";
import { KapsoProviderUnavailableError } from "~/server/whatsapp/kapso-onboarding";

const now = new Date("2026-09-07T12:00:00.000Z");

describe("caso de uso del ciclo de vida del enlace de configuración", () => {
  it("genera un enlace cuando el preflight está aprobado", async () => {
    const store = storeFixture();
    const provider = providerFixture();

    const result = await manageKapsoWhatsAppSetupLink(
      {
        action: "generate",
        actorIdentityId: "superadmin-1",
        actorType: "superadmin",
        clinicId: "clinic-1",
      },
      { appUrl: "https://app.praxia.test", now: () => now, provider, store },
    );

    expect(provider.createSetupLink).toHaveBeenCalledWith({
      allowedOrigin: "https://app.praxia.test",
      customerId: "kapso-customer-1",
      failureRedirectUrl: "https://app.praxia.test/configuracion/whatsapp",
      successRedirectUrl: "https://app.praxia.test/configuracion/whatsapp",
    });
    expect(result.setupLink).toMatchObject({
      status: "active",
      url: "https://app.kapso.ai/whatsapp/setup/new",
    });
    expect(result.setupLinkProviderId).toBe("kapso-link-new");
    expect(store.auditEvents).toContainEqual(
      expect.objectContaining({
        action: "setup-link-created",
        customerId: "kapso-customer-1",
        result: "succeeded",
      }),
    );
  });

  it("reutiliza el único enlace activo al generar de nuevo sin regenerar", async () => {
    const existing = setupLinkFixture({
      kapsoSetupLinkId: "kapso-link-existing",
      url: "https://app.kapso.ai/whatsapp/setup/existing",
    });
    const store = storeFixture({ setupLink: existing });
    const provider = providerFixture({
      remoteLinks: [kapsoLinkFixture(existing)],
    });

    const result = await manageKapsoWhatsAppSetupLink(
      {
        action: "generate",
        actorIdentityId: "superadmin-1",
        actorType: "superadmin",
        clinicId: "clinic-1",
      },
      { appUrl: "https://app.praxia.test", now: () => now, provider, store },
    );

    expect(provider.createSetupLink).not.toHaveBeenCalled();
    expect(result.setupLinkProviderId).toBe("kapso-link-existing");
    expect(store.auditEvents).toContainEqual(
      expect.objectContaining({
        action: "setup-link-confirmed",
        setupLinkId: "kapso-link-existing",
      }),
    );
  });

  it("revoca enlaces remotos duplicados antes de conservar uno activo", async () => {
    const existing = setupLinkFixture({
      kapsoSetupLinkId: "kapso-link-existing",
      url: "https://app.kapso.ai/whatsapp/setup/existing",
    });
    const duplicate = setupLinkFixture({
      kapsoSetupLinkId: "kapso-link-duplicate",
      url: "https://app.kapso.ai/whatsapp/setup/duplicate",
    });
    const store = storeFixture();
    const provider = providerFixture({
      remoteLinks: [kapsoLinkFixture(existing), kapsoLinkFixture(duplicate)],
    });

    const result = await manageKapsoWhatsAppSetupLink(
      {
        action: "generate",
        actorIdentityId: "superadmin-1",
        actorType: "superadmin",
        clinicId: "clinic-1",
      },
      { appUrl: "https://app.praxia.test", now: () => now, provider, store },
    );

    expect(provider.createSetupLink).not.toHaveBeenCalled();
    expect(provider.revokeSetupLink).toHaveBeenCalledWith({
      customerId: "kapso-customer-1",
      setupLinkId: "kapso-link-duplicate",
    });
    expect(result.setupLinkProviderId).toBe("kapso-link-existing");
  });

  it("sincroniza el estado usado informado por Kapso antes de mostrarlo", async () => {
    const existing = setupLinkFixture({
      kapsoSetupLinkId: "kapso-link-existing",
    });
    const store = storeFixture({ setupLink: existing });
    const provider = providerFixture({
      remoteLinks: [{ ...kapsoLinkFixture(existing), status: "used" }],
    });

    const result = await getKapsoWhatsAppOnboarding(
      {
        access: "clinic-owner",
        actorIdentityId: "owner-1",
        clinicId: "clinic-1",
      },
      store,
      provider,
    );

    expect(result.setupLink?.status).toBe("used");
    expect(store.auditEvents).toContainEqual(
      expect.objectContaining({
        action: "setup-link-used",
        setupLinkId: "kapso-link-existing",
      }),
    );
  });

  it("revoca el enlace local si Kapso dejó de reportarlo", async () => {
    const existing = setupLinkFixture({
      kapsoSetupLinkId: "kapso-link-existing",
    });
    const store = storeFixture({ setupLink: existing });
    const provider = providerFixture();

    const result = await getKapsoWhatsAppOnboarding(
      {
        access: "clinic-owner",
        actorIdentityId: "owner-1",
        clinicId: "clinic-1",
      },
      store,
      provider,
    );

    expect(result.setupLink?.status).toBe("revoked");
    expect(store.auditEvents).toContainEqual(
      expect.objectContaining({
        action: "setup-link-revoked",
        reason: "Kapso ya no reporta el enlace de configuración activo.",
        setupLinkId: "kapso-link-existing",
      }),
    );
  });

  it("reconcilia el enlace remoto si la unicidad local detecta una carrera", async () => {
    const store = storeFixture({ simulateActiveConflict: true });
    const provider = providerFixture();

    const result = await manageKapsoWhatsAppSetupLink(
      {
        action: "generate",
        actorIdentityId: "superadmin-1",
        actorType: "superadmin",
        clinicId: "clinic-1",
      },
      { appUrl: "https://app.praxia.test", now: () => now, provider, store },
    );

    expect(result.setupLinkProviderId).toBe("kapso-link-new");
    expect(provider.createSetupLink).toHaveBeenCalledTimes(1);
    expect(store.saveAccesses).toHaveLength(2);
  });

  it("regenera revocando primero el enlace anterior y conserva motivo y actor", async () => {
    const existing = setupLinkFixture({
      kapsoSetupLinkId: "kapso-link-old",
      url: "https://app.kapso.ai/whatsapp/setup/old",
    });
    const store = storeFixture({ setupLink: existing });
    const provider = providerFixture({
      remoteLinks: [kapsoLinkFixture(existing)],
    });

    const result = await manageKapsoWhatsAppSetupLink(
      {
        action: "regenerate",
        actorIdentityId: "superadmin-1",
        actorType: "superadmin",
        clinicId: "clinic-1",
        reason: "El QR anterior venció durante la sesión.",
      },
      { appUrl: "https://app.praxia.test", now: () => now, provider, store },
    );

    expect(provider.revokeSetupLink).toHaveBeenCalledWith({
      customerId: "kapso-customer-1",
      setupLinkId: "kapso-link-old",
    });
    expect(provider.createSetupLink).toHaveBeenCalledTimes(1);
    expect(provider.revokeSetupLink.mock.invocationCallOrder[0]).toBeLessThan(
      provider.createSetupLink.mock.invocationCallOrder[0]!,
    );
    expect(result.setupLinkProviderId).toBe("kapso-link-new");
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "setup-link-revoked",
          reason: "El QR anterior venció durante la sesión.",
        }),
        expect.objectContaining({
          action: "setup-link-regenerated",
          reason: "El QR anterior venció durante la sesión.",
        }),
      ]),
    );
  });

  it("revoca el enlace activo y muestra regeneración como siguiente acción", async () => {
    const existing = setupLinkFixture({
      kapsoSetupLinkId: "kapso-link-existing",
    });
    const store = storeFixture({ setupLink: existing });
    const provider = providerFixture({
      remoteLinks: [kapsoLinkFixture(existing)],
    });

    const result = await manageKapsoWhatsAppSetupLink(
      {
        action: "revoke",
        actorIdentityId: "superadmin-1",
        actorType: "superadmin",
        clinicId: "clinic-1",
        reason: "La Clínica solicitó detener el onboarding.",
      },
      { appUrl: "https://app.praxia.test", now: () => now, provider, store },
    );

    expect(provider.revokeSetupLink).toHaveBeenCalledTimes(1);
    expect(result.setupLinkProviderId).toBe("kapso-link-existing");
    expect(result.setupLink).toMatchObject({ status: "revoked" });
    expect(store.auditEvents).toContainEqual(
      expect.objectContaining({ action: "setup-link-revoked" }),
    );
  });

  it("permite al Médico propietario iniciar el flujo dentro de su Clínica", async () => {
    const store = storeFixture();
    const provider = providerFixture();

    await manageKapsoWhatsAppSetupLink(
      {
        action: "generate",
        actorIdentityId: "owner-1",
        actorType: "clinic-owner",
        clinicId: "clinic-1",
      },
      { appUrl: "https://app.praxia.test", now: () => now, provider, store },
    );

    expect(store.readAccesses).toContain("clinic-owner");
    expect(store.saveAccesses).toContain("clinic-owner");
  });

  it("no llama a Kapso si el preflight no está aprobado", async () => {
    const store = storeFixture({ preflightStatus: "blocked" });
    const provider = providerFixture();

    await expect(
      manageKapsoWhatsAppSetupLink(
        {
          action: "generate",
          actorIdentityId: "superadmin-1",
          actorType: "superadmin",
          clinicId: "clinic-1",
        },
        { appUrl: "https://app.praxia.test", now: () => now, provider, store },
      ),
    ).rejects.toThrow("preflight");
    expect(provider.listSetupLinks).not.toHaveBeenCalled();
  });

  it("audita el fallo de Kapso y no expone secretos", async () => {
    const store = storeFixture();
    const provider = providerFixture({ unavailable: true });

    await expect(
      manageKapsoWhatsAppSetupLink(
        {
          action: "generate",
          actorIdentityId: "superadmin-1",
          actorType: "superadmin",
          clinicId: "clinic-1",
        },
        { appUrl: "https://app.praxia.test", now: () => now, provider, store },
      ),
    ).rejects.toBeInstanceOf(KapsoProviderUnavailableError);
    expect(store.auditEvents).toContainEqual(
      expect.objectContaining({
        action: "setup-link-provider-unavailable",
        result: "failed",
      }),
    );
    expect(JSON.stringify(store.auditEvents)).not.toContain("token");
  });

  it("rechaza que el propietario regenere o revoque el enlace", async () => {
    const store = storeFixture();
    const provider = providerFixture();

    await expect(
      manageKapsoWhatsAppSetupLink(
        {
          action: "regenerate",
          actorIdentityId: "owner-1",
          actorType: "clinic-owner",
          clinicId: "clinic-1",
        },
        { appUrl: "https://app.praxia.test", now: () => now, provider, store },
      ),
    ).rejects.toThrow("solo puede iniciar");
    await expect(
      manageKapsoWhatsAppSetupLink(
        {
          action: "revoke",
          actorIdentityId: "owner-1",
          actorType: "clinic-owner",
          clinicId: "clinic-1",
        },
        { appUrl: "https://app.praxia.test", now: () => now, provider, store },
      ),
    ).rejects.toThrow("solo puede iniciar");
    expect(store.readAccesses).toEqual([]);
  });
});

type TestSetupLink = WhatsAppSetupLink & { providerId: string };

function setupLinkFixture(
  overrides: Partial<WhatsAppSetupLink> & { kapsoSetupLinkId?: string } = {},
): TestSetupLink {
  const { kapsoSetupLinkId, ...linkOverrides } = overrides;
  return {
    clinicId: "clinic-1",
    createdAt: now,
    expiresAt: new Date("2026-10-07T12:00:00.000Z"),
    id: "local-link-1",
    providerId: kapsoSetupLinkId ?? "kapso-link-new",
    revokedAt: null,
    status: "active",
    updatedAt: now,
    url: "https://app.kapso.ai/whatsapp/setup/new",
    usedAt: null,
    ...linkOverrides,
  };
}

function kapsoLinkFixture(link: TestSetupLink): KapsoSetupLink {
  return {
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    id: link.providerId,
    status: link.status,
    url: link.url,
    whatsappSetupError: null,
    whatsappSetupStatus: "pending",
  };
}

function providerFixture(
  options: {
    remoteLinks?: KapsoSetupLink[];
    unavailable?: boolean;
  } = {},
): KapsoOnboardingProvider & {
  createSetupLink: ReturnType<typeof vi.fn>;
  listSetupLinks: ReturnType<typeof vi.fn>;
  revokeSetupLink: ReturnType<typeof vi.fn>;
} {
  const newLink = kapsoLinkFixture(setupLinkFixture());
  const remoteLinks = options.remoteLinks ?? [];
  return {
    createCustomer: vi.fn(),
    createSetupLink: vi.fn(async () => {
      if (options.unavailable) throw new KapsoProviderUnavailableError();
      remoteLinks.push(newLink);
      return newLink;
    }),
    findCustomerByExternalId: vi.fn(),
    listPhoneNumbers: vi.fn(),
    listSetupLinks: vi.fn(async () => {
      if (options.unavailable) throw new KapsoProviderUnavailableError();
      return remoteLinks;
    }),
    revokeSetupLink: vi.fn(async (input: { setupLinkId: string }) => {
      if (options.unavailable) throw new KapsoProviderUnavailableError();
      const link = remoteLinks.find(
        (candidate) => candidate.id === input.setupLinkId,
      );
      if (link === undefined) throw new Error("link not found");
      return { ...link, status: "revoked" as const };
    }),
  };
}

function storeFixture(
  options: {
    preflightStatus?: "blocked" | "passed";
    simulateActiveConflict?: boolean;
    setupLink?: TestSetupLink;
  } = {},
): KapsoWhatsAppOnboardingStore & {
  auditEvents: Parameters<
    KapsoWhatsAppOnboardingStore["save"]
  >[0]["auditEvents"];
  readAccesses: string[];
  saveAccesses: string[];
} {
  let snapshot: KapsoWhatsAppOnboardingSnapshot = {
    clinicId: "clinic-1",
    clinicName: "Clínica Aurora",
    connection: null,
    customerId: "kapso-customer-1",
    ownerName: "Dra. Ana Reyes",
    preflight: {
      blockers: [],
      checkedAt: now,
      checks: {
        metaAuthority: "confirmed",
        numberAssociation: "available",
        numberOwnedByClinic: true,
        ownerConfirmed: true,
        phoneNumberE164: "+50370000000",
        qrDeviceAvailable: true,
        whatsappBusinessApp: "active",
      },
      nextAction: "Generar el Enlace de configuración de WhatsApp",
      reason: null,
      status: options.preflightStatus ?? "passed",
    },
    setupLink: options.setupLink ?? null,
    setupLinkHistory: [],
    setupLinkProviderError: null,
    setupLinkProviderId: options.setupLink?.providerId ?? null,
    setupLinkProviderStatus: options.setupLink ? "pending" : null,
  };
  let simulateActiveConflict = options.simulateActiveConflict ?? false;
  const store = {
    auditEvents: [] as Parameters<
      KapsoWhatsAppOnboardingStore["save"]
    >[0]["auditEvents"],
    readAccesses: [] as string[],
    saveAccesses: [] as string[],
    async read(input: { access?: string }) {
      store.readAccesses.push(input.access ?? "superadmin");
      return snapshot;
    },
    async save(input: Parameters<KapsoWhatsAppOnboardingStore["save"]>[0]) {
      store.saveAccesses.push(input.access ?? "superadmin");
      if (input.setupLink?.status === "active" && simulateActiveConflict) {
        simulateActiveConflict = false;
        throw Object.assign(new Error("unique setup link conflict"), {
          code: "23505",
          constraint_name: "whatsapp_setup_link_active_customer_unique",
        });
      }
      store.auditEvents.push(...input.auditEvents);
      if (input.setupLink !== undefined) {
        if (input.customerId === null) throw new Error("customer required");
        snapshot = {
          ...snapshot,
          setupLink: {
            ...setupLinkFixture(snapshot.setupLink ?? undefined),
            ...input.setupLink,
            clinicId: snapshot.clinicId,
            id: snapshot.setupLink?.id ?? "local-link-created",
            updatedAt: now,
          },
        };
        snapshot = {
          ...snapshot,
          setupLinkProviderId: input.setupLink.kapsoSetupLinkId,
          setupLinkProviderError: input.setupLink.providerError,
          setupLinkProviderStatus: input.setupLink.providerStatus,
        };
      }
    },
  } satisfies KapsoWhatsAppOnboardingStore & {
    auditEvents: Parameters<
      KapsoWhatsAppOnboardingStore["save"]
    >[0]["auditEvents"];
    readAccesses: string[];
    saveAccesses: string[];
  };
  return store;
}
