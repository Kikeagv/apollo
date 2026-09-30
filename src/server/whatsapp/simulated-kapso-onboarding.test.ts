import { describe, expect, it } from "vitest";

import { createSimulatedKapsoOnboardingProvider } from "./simulated-kapso-onboarding";

describe("proveedor simulado de onboarding de WhatsApp", () => {
  it("conserva customers y enlaces de configuración sin afirmar uso de Kapso", async () => {
    const provider = createSimulatedKapsoOnboardingProvider({
      now: () => new Date("2026-09-29T12:00:00.000Z"),
    });

    expect(provider.source).toBe("simulated");
    const customer = await provider.createCustomer({
      externalCustomerId: "praxia-clinic:clinic-1",
      name: "Clínica Demo",
    });
    expect(
      await provider.findCustomerByExternalId("praxia-clinic:clinic-1"),
    ).toEqual(customer);

    const link = await provider.createSetupLink({
      allowedOrigin: "https://praxia.test",
      connectionType: "coexistence",
      customerId: customer.id,
      failureRedirectUrl: "https://praxia.test/return",
      successRedirectUrl: "https://praxia.test/return",
    });

    expect(link.url).toMatch(/^https:\/\/praxia\.test\/simulated-setup\//);
    expect(await provider.listSetupLinks(customer.id)).toEqual([link]);
    expect(
      await provider.revokeSetupLink({
        customerId: customer.id,
        setupLinkId: link.id,
      }),
    ).toMatchObject({ whatsappSetupStatus: "failed" });
  });
});
