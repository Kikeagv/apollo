import { describe, expect, it, vi } from "vitest";

import type {
  KapsoWhatsAppOnboardingSnapshot,
  KapsoWhatsAppOnboardingStore,
} from "./kapso-onboarding";
import { prepareKapsoWhatsAppOnboarding } from "./kapso-onboarding";
import type {
  KapsoOnboardingProvider,
  KapsoCustomer,
} from "~/server/whatsapp/kapso-onboarding";
import { KapsoProviderUnavailableError } from "~/server/whatsapp/kapso-onboarding";

const baseInput = {
  actorIdentityId: "superadmin-1",
  clinicId: "clinic-1",
  metaAuthority: "confirmed" as const,
  numberOwnedByClinic: true,
  ownerConfirmed: true,
  ownerName: "Dra. Ana Reyes",
  phoneNumberE164: "+50370000000",
  qrDeviceAvailable: true,
  whatsappBusinessApp: "active" as const,
};

describe("caso de uso de onboarding Kapso", () => {
  it("crea el customer, confirma el número y deja el preflight listo para el enlace", async () => {
    const customer = customerFixture();
    const provider = providerFixture({ customer });
    const store = storeFixture();

    const result = await prepareKapsoWhatsAppOnboarding(baseInput, {
      provider,
      store,
    });

    const { createCustomer, listPhoneNumbers } = provider;
    expect(createCustomer).toHaveBeenCalledWith({
      externalCustomerId: "praxia-clinic:clinic-1",
      name: "Clínica Aurora",
    });
    expect(listPhoneNumbers).toHaveBeenCalledTimes(1);
    expect(result.preflight).toMatchObject({
      blockers: [],
      nextAction: "Generar el Enlace de configuración de WhatsApp",
      status: "passed",
    });
    expect(result.customerId).toBe(customer.id);
    expect(store.saved?.connection).toMatchObject({
      connectionType: "coexistence",
      phoneNumberE164: baseInput.phoneNumberE164,
      provider: "kapso",
      status: "pending",
    });
    expect(store.saved?.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "customer-created",
          result: "succeeded",
        }),
        expect.objectContaining({
          action: "preflight-executed",
          result: "succeeded",
        }),
      ]),
    );
  });

  it("es idempotente cuando Kapso ya devolvió el customer de la Clínica", async () => {
    const provider = providerFixture({ customer: customerFixture() });
    const store = storeFixture();

    await prepareKapsoWhatsAppOnboarding(baseInput, { provider, store });
    await prepareKapsoWhatsAppOnboarding(baseInput, { provider, store });

    const { createCustomer, findCustomerByExternalId } = provider;
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(findCustomerByExternalId).toHaveBeenCalledTimes(2);
  });

  it("no degrada una Conexión Kapso que ya está lista", async () => {
    const provider = providerFixture({ customer: customerFixture() });
    const store = storeFixture({ readyKapso: true });

    const result = await prepareKapsoWhatsAppOnboarding(baseInput, {
      provider,
      store,
    });

    expect(store.saved?.connection).toBeUndefined();
    expect(result.connection).toMatchObject({
      phoneNumberId: "existing-phone",
      provider: "kapso",
      status: "ready",
    });
  });

  it("reintenta la consulta cuando la creación responde conflicto", async () => {
    const customer = customerFixture();
    const provider = providerFixture({ customer, createConflict: true });
    const store = storeFixture();

    const result = await prepareKapsoWhatsAppOnboarding(baseInput, {
      provider,
      store,
    });

    expect(result.customerId).toBe(customer.id);
    const { findCustomerByExternalId } = provider;
    expect(findCustomerByExternalId).toHaveBeenCalledTimes(2);
    expect(result.preflight?.status).toBe("passed");
  });

  it("bloquea una confirmación que no coincide con el propietario persistido", async () => {
    const provider = providerFixture({ customer: customerFixture() });
    const store = storeFixture();

    const result = await prepareKapsoWhatsAppOnboarding(
      { ...baseInput, ownerName: "Dr. Otro Médico" },
      { provider, store },
    );

    expect(result.preflight?.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "owner-not-confirmed" }),
      ]),
    );
    expect(result.preflight?.status).toBe("blocked");
  });

  it("bloquea si no existe un propietario persistido para la Clínica", async () => {
    const provider = providerFixture({ customer: customerFixture() });
    const store = storeFixture({ withoutOwner: true });

    const result = await prepareKapsoWhatsAppOnboarding(baseInput, {
      provider,
      store,
    });

    expect(result.preflight?.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(["clinic-data-incomplete", "owner-not-confirmed"]),
    );
  });

  it.each([
    [
      "WhatsApp Messenger personal",
      { whatsappBusinessApp: "messenger-only" as const },
      "messenger-not-supported",
    ],
    [
      "autoridad Meta no confirmada",
      { metaAuthority: "not-confirmed" as const },
      "meta-authority-required",
    ],
    [
      "número asociado con otro customer",
      { phoneAssociation: "other-customer" as const },
      "number-associated",
    ],
  ])("bloquea el preflight por %s", async (_scenario, override, code) => {
    const provider = providerFixture({
      customer: customerFixture(),
      otherCustomerPhone:
        "phoneAssociation" in override &&
        override.phoneAssociation === "other-customer",
    });
    const store = storeFixture();

    const result = await prepareKapsoWhatsAppOnboarding(
      { ...baseInput, ...override },
      { provider, store },
    );

    expect(result.preflight?.status).toBe("blocked");
    expect(result.preflight?.blockers.map((blocker) => blocker.code)).toContain(
      code,
    );
    expect(store.saved?.connection).toMatchObject({
      provider: "kapso",
      status: "blocked",
    });
  });

  it("conserva el estado existente y deja el resultado indisponible si Kapso no responde", async () => {
    const provider = providerFixture({
      customer: customerFixture(),
      unavailable: true,
    });
    const store = storeFixture();

    const result = await prepareKapsoWhatsAppOnboarding(
      { ...baseInput, whatsappBusinessApp: "messenger-only" },
      { provider, store },
    );

    expect(result.preflight).toMatchObject({
      status: "unavailable",
    });
    expect(result.preflight?.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "messenger-not-supported" }),
      ]),
    );
    expect(result.connection?.provider).toBe("simulated");
    expect(store.saved?.connection).toBeUndefined();
    expect(store.saved?.auditEvents).toContainEqual(
      expect.objectContaining({
        action: "onboarding-provider-unavailable",
        result: "failed",
      }),
    );
    expect(JSON.stringify(result)).not.toContain("kapso-secret");
  });
});

function customerFixture(): KapsoCustomer {
  return {
    externalCustomerId: "praxia-clinic:clinic-1",
    id: "kapso-customer-1",
    name: "Clínica Aurora",
  };
}

function providerFixture(options: {
  createConflict?: boolean;
  customer: KapsoCustomer;
  otherCustomerPhone?: boolean;
  unavailable?: boolean;
}): KapsoOnboardingProvider & {
  createCustomer: ReturnType<typeof vi.fn>;
  findCustomerByExternalId: ReturnType<typeof vi.fn>;
  listPhoneNumbers: ReturnType<typeof vi.fn>;
} {
  let customerFound = false;
  return {
    createCustomer: vi.fn(async () => {
      if (options.unavailable) throw new KapsoProviderUnavailableError();
      if (options.createConflict) {
        customerFound = true;
        const error = new Error("conflict");
        Object.assign(error, { status: 409 });
        throw error;
      }
      customerFound = true;
      return options.customer;
    }),
    createSetupLink: vi.fn(async () => {
      throw new Error("setup link not used in this test");
    }),
    findCustomerByExternalId: vi.fn(async () => {
      if (options.unavailable) throw new KapsoProviderUnavailableError();
      return customerFound ? options.customer : undefined;
    }),
    listPhoneNumbers: vi.fn(async () => {
      if (options.unavailable) throw new KapsoProviderUnavailableError();
      return [
        {
          customerId: options.otherCustomerPhone
            ? "kapso-customer-other"
            : options.customer.id,
          displayPhoneNumber: "+50370000000",
          displayPhoneNumberNormalized: "50370000000",
          isCoexistence: true,
          phoneNumberId: "phone-1",
        },
      ];
    }),
    listSetupLinks: vi.fn(async () => []),
    revokeSetupLink: vi.fn(async () => {
      throw new Error("setup link not used in this test");
    }),
  };
}

function storeFixture(
  options: { readyKapso?: boolean; withoutOwner?: boolean } = {},
): KapsoWhatsAppOnboardingStore & {
  saved?: Parameters<KapsoWhatsAppOnboardingStore["save"]>[0];
} {
  let snapshot: KapsoWhatsAppOnboardingSnapshot = {
    clinicId: "clinic-1",
    clinicName: "Clínica Aurora",
    connection: {
      clinicId: "clinic-1",
      connectionType: "simulated",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      customer: options.readyKapso ? "kapso-customer-1" : "simulated:clinic-1",
      lastTestAt: new Date("2026-09-01T00:00:00.000Z"),
      metadata: { mode: "simulated" },
      phoneNumberE164: options.readyKapso ? "+50370000000" : "+50370000001",
      phoneNumberId: options.readyKapso ? "existing-phone" : null,
      provider: options.readyKapso ? "kapso" : "simulated",
      status: "ready",
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
    customerId: null,
    ownerName: options.withoutOwner ? null : "Dra. Ana Reyes",
    preflight: null,
    setupLink: null,
    setupLinkHistory: [],
    setupLinkProviderError: null,
    setupLinkProviderId: null,
    setupLinkProviderStatus: null,
  };
  const store = {
    saved: undefined as
      Parameters<KapsoWhatsAppOnboardingStore["save"]>[0] | undefined,
    async read() {
      return snapshot;
    },
    async save(input: Parameters<KapsoWhatsAppOnboardingStore["save"]>[0]) {
      store.saved = input;
      if (input.connection !== undefined) {
        snapshot = {
          ...snapshot,
          connection: {
            ...snapshot.connection!,
            ...input.connection,
            customer: input.customerId!,
            provider: "kapso",
            updatedAt: new Date(),
          },
        };
      }
      snapshot = {
        ...snapshot,
        customerId: input.customerId,
        preflight: input.preflight ?? snapshot.preflight,
      };
    },
  } satisfies KapsoWhatsAppOnboardingStore & {
    saved?: Parameters<KapsoWhatsAppOnboardingStore["save"]>[0];
  };
  return store;
}
