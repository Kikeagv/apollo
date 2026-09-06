import { describe, expect, it, vi } from "vitest";

import {
  createKapsoOnboardingProvider,
  KapsoProviderUnavailableError,
} from "./kapso-onboarding";

describe("adaptador de onboarding de Kapso", () => {
  it("consulta customers por external_customer_id sin exponer la API key", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              created_at: "2026-09-06T12:00:00.000Z",
              external_customer_id: "praxia-clinic-clinic-1",
              id: "kapso-customer-1",
              name: "Clínica Aurora",
              updated_at: "2026-09-06T12:00:00.000Z",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = createKapsoOnboardingProvider({
      apiKey: "kapso-secret",
      fetchImpl,
    });

    await expect(
      provider.findCustomerByExternalId("praxia-clinic-clinic-1"),
    ).resolves.toEqual({
      externalCustomerId: "praxia-clinic-clinic-1",
      id: "kapso-customer-1",
      name: "Clínica Aurora",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.kapso.ai/platform/v1/customers?external_customer_id=praxia-clinic-clinic-1",
      expect.objectContaining({
        headers: {
          "X-API-Key": "kapso-secret",
        },
        method: "GET",
      }),
    );
  });

  it("crea un customer con el identificador externo estable de la Clínica", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            external_customer_id: "praxia-clinic-clinic-1",
            id: "kapso-customer-1",
            name: "Clínica Aurora",
          },
        }),
        { status: 201 },
      ),
    );
    const provider = createKapsoOnboardingProvider({
      apiKey: "kapso-secret",
      fetchImpl,
    });

    await expect(
      provider.createCustomer({
        externalCustomerId: "praxia-clinic-clinic-1",
        name: "Clínica Aurora",
      }),
    ).resolves.toMatchObject({
      id: "kapso-customer-1",
      name: "Clínica Aurora",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.kapso.ai/platform/v1/customers",
      expect.objectContaining({
        body: JSON.stringify({
          customer: {
            external_customer_id: "praxia-clinic-clinic-1",
            name: "Clínica Aurora",
          },
        }),
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "kapso-secret",
        },
        method: "POST",
      }),
    );
  });

  it("lee asociaciones de números sin traer tokens ni credenciales", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              access_token: "must-not-cross-the-boundary",
              customer_id: "kapso-customer-1",
              display_phone_number: "+50370000000",
              display_phone_number_normalized: "50370000000",
              is_coexistence: true,
              phone_number_id: "phone-1",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = createKapsoOnboardingProvider({
      apiKey: "kapso-secret",
      fetchImpl,
    });

    await expect(provider.listPhoneNumbers()).resolves.toEqual([
      {
        customerId: "kapso-customer-1",
        displayPhoneNumber: "+50370000000",
        displayPhoneNumberNormalized: "50370000000",
        isCoexistence: true,
        phoneNumberId: "phone-1",
      },
    ]);
  });

  it("recorre todas las páginas del catálogo de números", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                customer_id: "kapso-customer-1",
                display_phone_number: "+50370000000",
                display_phone_number_normalized: "50370000000",
                phone_number_id: "phone-1",
              },
            ],
            meta: { page: 1, per_page: 100, total_count: 2, total_pages: 2 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                customer_id: "kapso-customer-2",
                display_phone_number: "+50370000001",
                display_phone_number_normalized: "50370000001",
                phone_number_id: "phone-2",
              },
            ],
            meta: { page: 2, per_page: 100, total_count: 2, total_pages: 2 },
          }),
          { status: 200 },
        ),
      );
    const provider = createKapsoOnboardingProvider({
      apiKey: "kapso-secret",
      fetchImpl,
    });

    await expect(provider.listPhoneNumbers()).resolves.toHaveLength(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.kapso.ai/platform/v1/whatsapp/phone_numbers?page=2&per_page=100",
      expect.anything(),
    );
  });

  it("convierte respuestas con forma inválida en un error seguro del proveedor", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "missing-fields" }] }), {
        status: 200,
      }),
    );
    const provider = createKapsoOnboardingProvider({
      apiKey: "kapso-secret",
      fetchImpl,
    });

    await expect(provider.findCustomerByExternalId("clinic-1")).rejects.toThrow(
      "Kapso devolvió una respuesta inválida",
    );
  });

  it("falla cerrado cuando Kapso no está configurado o no responde", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error("network error with kapso-secret in a provider trace"),
      );
    const provider = createKapsoOnboardingProvider({
      apiKey: "kapso-secret",
      fetchImpl,
    });

    const unavailable = provider.listPhoneNumbers();
    await expect(unavailable).rejects.toBeInstanceOf(
      KapsoProviderUnavailableError,
    );
    await expect(unavailable).rejects.toThrow("Kapso no está disponible");
    await expect(
      createKapsoOnboardingProvider({ fetchImpl }).listPhoneNumbers(),
    ).rejects.toThrow("Kapso no está disponible");
    await expect(unavailable).rejects.not.toThrow("kapso-secret");
  });
});
