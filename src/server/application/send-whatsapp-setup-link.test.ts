import { describe, expect, it, vi } from "vitest";

import type { ClinicRegistrationStore } from "./clinic-registration";
import type {
  KapsoWhatsAppSetupLinkAuditEvent,
  KapsoWhatsAppOnboardingSnapshot,
  KapsoWhatsAppOnboardingStore,
} from "./kapso-onboarding";
import { sendWhatsAppSetupLinkToOwner } from "./send-whatsapp-setup-link";
import type {
  KapsoOnboardingProvider,
  KapsoSetupLink,
} from "~/server/whatsapp/kapso-onboarding";

describe("envío del Enlace de configuración al propietario", () => {
  it("genera o confirma el enlace activo y lo entrega al correo registrado", async () => {
    const fixture = createFixture();
    const sendWhatsAppSetupLink = vi.fn(async () => undefined);

    const result = await sendWhatsAppSetupLinkToOwner(
      { actorIdentityId: "superadmin-1", clinicId: "clinic-1" },
      {
        appUrl: "https://app.praxia.test",
        emailSender: { sendWhatsAppSetupLink },
        onboardingStore: fixture.store,
        ownerStore: fixture.ownerStore,
        provider: fixture.provider,
        now: () => new Date("2026-09-29T12:00:00.000Z"),
      },
    );

    expect(sendWhatsAppSetupLink).toHaveBeenCalledWith({
      clinicName: "Clínica Aurora",
      expiresAt: new Date("2026-10-29T12:00:00.000Z"),
      ownerEmail: "ana@aurora.test",
      ownerName: "Dra. Ana Reyes",
      setupLinkUrl: "https://simulated.praxia.test/setup/link-1",
    });
    expect(fixture.createSetupLink).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      deliveryStatus: "sent",
      ownerEmail: "ana@aurora.test",
      snapshot: {
        setupLink: { id: "local-link-1", status: "active" },
        setupLinkHistory: [
          expect.objectContaining({
            action: "setup-link-created",
            result: "succeeded",
          }),
          expect.objectContaining({
            action: "setup-link-email-sent",
            result: "succeeded",
          }),
        ],
      },
    });
  });

  it("conserva el enlace y registra el fallo para que el envío se pueda reintentar", async () => {
    const fixture = createFixture();
    const sendWhatsAppSetupLink = vi.fn(async () => {
      throw new Error("Resend no disponible");
    });

    const result = await sendWhatsAppSetupLinkToOwner(
      { actorIdentityId: "superadmin-1", clinicId: "clinic-1" },
      {
        appUrl: "https://app.praxia.test",
        emailSender: { sendWhatsAppSetupLink },
        onboardingStore: fixture.store,
        ownerStore: fixture.ownerStore,
        provider: fixture.provider,
        now: () => new Date("2026-09-29T12:00:00.000Z"),
      },
    );

    expect(result).toMatchObject({
      deliveryStatus: "failed",
      ownerEmail: "ana@aurora.test",
      snapshot: {
        setupLink: { id: "local-link-1", status: "active" },
      },
    });
    expect(result.snapshot.setupLinkHistory).toContainEqual(
      expect.objectContaining({
        action: "setup-link-email-failed",
        result: "failed",
      }),
    );
    expect(result.message).toContain("reintentar");
  });
});

function createFixture() {
  const setupLink: KapsoSetupLink = {
    createdAt: new Date("2026-09-29T12:00:00.000Z"),
    expiresAt: new Date("2026-10-29T12:00:00.000Z"),
    id: "link-1",
    status: "active",
    url: "https://simulated.praxia.test/setup/link-1",
    whatsappSetupError: null,
    whatsappSetupStatus: "pending",
  };
  let snapshot = onboardingSnapshot();
  const store: KapsoWhatsAppOnboardingStore = {
    async read() {
      return snapshot;
    },
    async save(input) {
      snapshot = {
        ...snapshot,
        ...(input.setupLink === undefined
          ? {}
          : {
              setupLink: {
                clinicId: input.clinicId,
                createdAt: input.setupLink.createdAt,
                expiresAt: input.setupLink.expiresAt,
                id: "local-link-1",
                revokedAt: input.setupLink.revokedAt,
                status: input.setupLink.status,
                updatedAt: input.setupLink.createdAt,
                url: input.setupLink.url,
                usedAt: input.setupLink.usedAt,
              },
              setupLinkProviderId: input.setupLink.kapsoSetupLinkId,
            }),
        setupLinkHistory: [
          ...snapshot.setupLinkHistory,
          ...input.auditEvents
            .filter((event) => event.action.startsWith("setup-link-"))
            .map((event): KapsoWhatsAppSetupLinkAuditEvent => ({
              action:
                event.action as KapsoWhatsAppSetupLinkAuditEvent["action"],
              actorIdentityId: input.actorIdentityId,
              occurredAt: new Date("2026-09-29T12:00:00.000Z"),
              reason: event.reason,
              result: event.result,
              setupLinkId: event.setupLinkId ?? null,
            })),
        ],
      };
    },
  };
  const createSetupLink = vi.fn(async () => setupLink);
  const provider: KapsoOnboardingProvider = {
    async createCustomer() {
      throw new Error("No debe crear un customer para esta prueba");
    },
    async findCustomerByExternalId() {
      return undefined;
    },
    async listPhoneNumbers() {
      return [];
    },
    createSetupLink,
    async listSetupLinks() {
      return [];
    },
    async revokeSetupLink() {
      return undefined;
    },
  };
  const ownerStore: ClinicRegistrationStore = {
    async read() {
      return {
        clinic: { id: "clinic-1", isSynthetic: false, name: "Clínica Aurora" },
        invitation: {
          delivery: {
            attempts: 1,
            canRetry: false,
            lastAttempt: "succeeded",
            lastError: null,
            status: "sent",
          },
          email: "ana@aurora.test",
          expiresAt: new Date("2026-10-02T00:00:00.000Z"),
          id: "invitation-1",
          nextAction: "accept",
          recipientName: "Dra. Ana Reyes",
          status: "pending",
        },
      };
    },
    async register() {
      throw new Error("No debe registrar otra Clínica");
    },
    async prepareInvitationDelivery() {
      throw new Error("No debe enviar invitación de acceso");
    },
    async recordInvitationDelivery() {
      throw new Error("No debe cambiar invitación de acceso");
    },
  };

  return { createSetupLink, provider, ownerStore, snapshot, store };
}

function onboardingSnapshot(): KapsoWhatsAppOnboardingSnapshot {
  return {
    clinicId: "clinic-1",
    clinicName: "Clínica Aurora",
    connection: null,
    customerId: "customer-1",
    ownerAccess: "pending",
    ownerName: "Dra. Ana Reyes",
    preflight: {
      blockers: [],
      checkedAt: new Date("2026-09-29T11:00:00.000Z"),
      checks: null,
      nextAction: "Generar el Enlace de configuración de WhatsApp",
      reason: null,
      status: "passed",
    },
    setupLink: null,
    setupLinkHistory: [],
    setupLinkProviderError: null,
    setupLinkProviderId: null,
    setupLinkProviderStatus: null,
  };
}
