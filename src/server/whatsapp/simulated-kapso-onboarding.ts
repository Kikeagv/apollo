import { randomUUID } from "node:crypto";

import { setupLinkExpiresAt } from "~/domain/whatsapp-setup-link";
import type {
  KapsoCustomer,
  KapsoOnboardingProvider,
  KapsoSetupLink,
} from "./kapso-onboarding";

/** Proveedor determinista de pruebas; nunca se selecciona en producción. */
export function createSimulatedKapsoOnboardingProvider(options?: {
  now?: () => Date;
}): KapsoOnboardingProvider {
  const now = options?.now ?? (() => new Date());
  const customersByExternalId = new Map<string, KapsoCustomer>();
  const setupLinksByCustomer = new Map<string, KapsoSetupLink[]>();

  return {
    source: "simulated",

    async createCustomer(input) {
      const existing = customersByExternalId.get(input.externalCustomerId);
      if (existing) return existing;
      const customer = {
        externalCustomerId: input.externalCustomerId,
        id: `sim-customer-${randomUUID()}`,
        name: input.name,
      };
      customersByExternalId.set(input.externalCustomerId, customer);
      return customer;
    },

    async findCustomerByExternalId(externalCustomerId) {
      return customersByExternalId.get(externalCustomerId);
    },

    async listPhoneNumbers() {
      return [];
    },

    async createSetupLink(input) {
      if (
        ![...customersByExternalId.values()].some(
          (customer) => customer.id === input.customerId,
        )
      ) {
        throw new Error("La Clínica no tiene un customer simulado registrado.");
      }
      const createdAt = now();
      const origin = new URL(input.allowedOrigin);
      const safeOrigin =
        origin.protocol === "https:"
          ? origin.origin
          : "https://simulated.praxia.test";
      const link: KapsoSetupLink = {
        createdAt,
        expiresAt: setupLinkExpiresAt(createdAt),
        id: `sim-setup-${randomUUID()}`,
        status: "active",
        url: `${safeOrigin}/simulated-setup/${randomUUID()}`,
        whatsappSetupError: null,
        whatsappSetupStatus: "pending",
      };
      const links = setupLinksByCustomer.get(input.customerId) ?? [];
      setupLinksByCustomer.set(input.customerId, [...links, link]);
      return link;
    },

    async listSetupLinks(customerId) {
      return [...(setupLinksByCustomer.get(customerId) ?? [])];
    },

    async revokeSetupLink({ customerId, setupLinkId }) {
      const links = setupLinksByCustomer.get(customerId) ?? [];
      const index = links.findIndex((link) => link.id === setupLinkId);
      if (index < 0) return undefined;
      const current = links[index]!;
      const revoked = {
        ...current,
        status: "revoked" as const,
        whatsappSetupStatus: "failed" as const,
      };
      links[index] = revoked;
      setupLinksByCustomer.set(customerId, links);
      return revoked;
    },
  };
}
