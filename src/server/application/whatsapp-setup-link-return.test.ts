import { describe, expect, it, vi } from "vitest";

import type {
  KapsoOnboardingProvider,
  KapsoSetupLink,
} from "~/server/whatsapp/kapso-onboarding";
import { KapsoProviderUnavailableError } from "~/server/whatsapp/kapso-onboarding";
import { whatsappSetupLinkReturnUrl } from "~/domain/whatsapp-setup-link-return";
import {
  processWhatsAppSetupLinkReturn,
  type KapsoWhatsAppSetupLinkReturnStore,
} from "./whatsapp-setup-link-return";

const now = new Date("2026-09-22T12:00:00.000Z");

describe("retorno verificable del enlace de configuración de WhatsApp", () => {
  it("construye un retorno estable desde el origen público", () => {
    expect(
      whatsappSetupLinkReturnUrl("https://app.praxia.test/configuracion"),
    ).toBe("https://app.praxia.test/whatsapp/activacion/retorno");
  });

  it.each([
    ["cancelled", "facebook_auth_failed", "revoked", "pending"],
    ["failed", "phone_verification_failed", "used", "failed"],
    ["pending", undefined, "active", "pending"],
    ["expired", "link_expired", "expired", "pending"],
    ["success", undefined, "used", "completed"],
  ] as const)(
    "distingue el resultado %s tras validar el enlace en Kapso",
    async (expectedStatus, errorCode, remoteStatus, remoteSetupStatus) => {
      const store = returnStore();
      const provider = providerFixture({
        remoteLink: {
          ...remoteLink,
          status: remoteStatus,
          whatsappSetupStatus: remoteSetupStatus,
          whatsappSetupError:
            remoteSetupStatus === "failed" ? "Kapso rechazó la conexión" : null,
        },
      });

      const result = await processWhatsAppSetupLinkReturn(
        {
          errorCode,
          setupLinkId: "kapso-link-1",
          status: expectedStatus === "success" ? "completed" : undefined,
        },
        { now: () => now, provider, store },
      );

      expect(result).toMatchObject({
        connectionReady: false,
        status: expectedStatus,
        verified: true,
      });
      expect(store.lastRecord).toMatchObject({
        errorCode: errorCode ?? null,
        status: expectedStatus,
      });
    },
  );

  it("no deja que el redirect contradiga el estado pendiente de Kapso", async () => {
    const store = returnStore();
    const provider = providerFixture();

    await expect(
      processWhatsAppSetupLinkReturn(
        {
          errorCode: "phone_verification_failed",
          setupLinkId: "kapso-link-1",
          status: "failed",
        },
        { now: () => now, provider, store },
      ),
    ).resolves.toMatchObject({ status: "pending", verified: true });
    expect(store.lastRecord?.errorCode).toBeNull();
  });

  it("descarta códigos de error arbitrarios del redirect", async () => {
    const store = returnStore();
    const provider = providerFixture({
      remoteLink: {
        ...remoteLink,
        status: "used",
        whatsappSetupStatus: "completed",
      },
    });

    const result = await processWhatsAppSetupLinkReturn(
      {
        errorCode: "access_token=must-not-cross-boundary",
        setupLinkId: "kapso-link-1",
        status: "completed",
      },
      { now: () => now, provider, store },
    );

    expect(result.errorCode).toBeNull();
    expect(store.lastRecord?.errorCode).toBeNull();
  });

  it("descarta un error permitido si Kapso confirma éxito", async () => {
    const store = returnStore();
    const provider = providerFixture({
      remoteLink: {
        ...remoteLink,
        status: "used",
        whatsappSetupStatus: "completed",
      },
    });

    const result = await processWhatsAppSetupLinkReturn(
      {
        errorCode: "phone_verification_failed",
        setupLinkId: "kapso-link-1",
        status: "failed",
      },
      { now: () => now, provider, store },
    );

    expect(result).toMatchObject({ errorCode: null, status: "success" });
    expect(store.lastRecord?.errorCode).toBeNull();
  });

  it("conserva el retorno como estado idempotente y no crea asociaciones", async () => {
    const store = returnStore();
    const provider = providerFixture({
      remoteLink: {
        ...remoteLink,
        status: "used",
        whatsappSetupStatus: "completed",
      },
    });

    await processWhatsAppSetupLinkReturn(
      { setupLinkId: "kapso-link-1", status: "completed" },
      { now: () => now, provider, store },
    );
    await processWhatsAppSetupLinkReturn(
      { setupLinkId: "kapso-link-1", status: "completed" },
      { now: () => now, provider, store },
    );

    expect(store.recordCount).toBe(1);
    expect(store.associationCount).toBe(0);
  });

  it("queda pendiente si Kapso no permite verificar el retorno", async () => {
    const store = returnStore();
    const provider = providerFixture({ unavailable: true });

    await expect(
      processWhatsAppSetupLinkReturn(
        { setupLinkId: "kapso-link-1", status: "completed" },
        { now: () => now, provider, store },
      ),
    ).resolves.toMatchObject({
      connectionReady: false,
      status: "pending",
      verified: false,
    });
    expect(store.lastRecord).toBeUndefined();
  });

  it("rechaza un identificador que no pertenece a un enlace local", async () => {
    const store = returnStore({ missing: true });
    const provider = providerFixture();

    await expect(
      processWhatsAppSetupLinkReturn(
        { setupLinkId: "kapso-link-unknown", status: "completed" },
        { now: () => now, provider, store },
      ),
    ).resolves.toMatchObject({ status: "failed", verified: false });
    expect(provider.listSetupLinks).not.toHaveBeenCalled();
  });
});

const remoteLink: KapsoSetupLink = {
  createdAt: now,
  expiresAt: new Date("2026-10-22T12:00:00.000Z"),
  id: "kapso-link-1",
  status: "active",
  url: "https://app.kapso.ai/whatsapp/setup/1",
  whatsappSetupError: null,
  whatsappSetupStatus: "pending",
};

function providerFixture(
  options: {
    remoteLink?: KapsoSetupLink;
    unavailable?: boolean;
  } = {},
) {
  return {
    createCustomer: vi.fn(),
    createSetupLink: vi.fn(),
    findCustomerByExternalId: vi.fn(),
    listPhoneNumbers: vi.fn(),
    listSetupLinks: vi.fn(async () => {
      if (options.unavailable) throw new KapsoProviderUnavailableError();
      return [options.remoteLink ?? remoteLink];
    }),
    revokeSetupLink: vi.fn(),
  } satisfies KapsoOnboardingProvider;
}

function returnStore(options: { missing?: boolean } = {}) {
  let lastRecord:
    | Parameters<KapsoWhatsAppSetupLinkReturnStore["recordSetupLinkReturn"]>[0]
    | undefined;
  let recordCount = 0;
  const associationCount = 0;

  const store: KapsoWhatsAppSetupLinkReturnStore & {
    associationCount: number;
    lastRecord: typeof lastRecord;
    recordCount: number;
  } = {
    async findSetupLinkByProviderId() {
      if (options.missing) return undefined;
      return {
        clinicId: "clinic-1",
        customerId: "kapso-customer-1",
        expiresAt: remoteLink.expiresAt,
        kapsoSetupLinkId: remoteLink.id,
        status: "active" as const,
      };
    },
    get lastRecord() {
      return lastRecord;
    },
    get associationCount() {
      return associationCount;
    },
    get recordCount() {
      return recordCount;
    },
    async recordSetupLinkReturn(input) {
      if (
        lastRecord?.status === input.status &&
        lastRecord.errorCode === input.errorCode
      ) {
        return false;
      }
      lastRecord = input;
      recordCount += 1;
      return true;
    },
  };
  return store;
}
