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

  it("rechaza un customer que Kapso devuelve con otro identificador externo", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              external_customer_id: "praxia-clinic-other",
              id: "kapso-customer-other",
              name: "Otra Clínica",
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
    ).rejects.toThrow("customer distinto");
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

  it("genera un enlace de coexistence con billing partner_managed", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            created_at: "2026-09-07T12:00:00.000Z",
            expires_at: "2026-10-07T12:00:00.000Z",
            id: "setup-link-1",
            meta_billing_mode: "partner_managed",
            status: "active",
            token: "must-not-cross-the-boundary",
            url: "https://app.kapso.ai/whatsapp/setup/opaque-link",
            whatsapp_setup_error: null,
            whatsapp_setup_status: "pending",
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
      provider.createSetupLink({
        allowedOrigin: "https://app.usepraxia.com",
        customerId: "kapso-customer-1",
        failureRedirectUrl: "https://app.usepraxia.com/configuracion/whatsapp",
        successRedirectUrl: "https://app.usepraxia.com/configuracion/whatsapp",
      }),
    ).resolves.toEqual({
      createdAt: new Date("2026-09-07T12:00:00.000Z"),
      expiresAt: new Date("2026-10-07T12:00:00.000Z"),
      id: "setup-link-1",
      status: "active",
      url: "https://app.kapso.ai/whatsapp/setup/opaque-link",
      whatsappSetupError: null,
      whatsappSetupStatus: "pending",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.kapso.ai/platform/v1/customers/kapso-customer-1/setup_links",
      expect.objectContaining({
        body: JSON.stringify({
          setup_link: {
            allowed_connection_types: ["coexistence"],
            allowed_origins: ["https://app.usepraxia.com"],
            failure_redirect_url:
              "https://app.usepraxia.com/configuracion/whatsapp",
            language: "es",
            meta_billing_mode: "partner_managed",
            provision_phone_number: false,
            success_redirect_url:
              "https://app.usepraxia.com/configuracion/whatsapp",
          },
        }),
        method: "POST",
      }),
    );
  });

  it("limita el enlace dedicated a la conexión API", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            created_at: "2026-09-07T12:00:00.000Z",
            expires_at: "2026-10-07T12:00:00.000Z",
            id: "setup-link-dedicated",
            status: "active",
            url: "https://app.kapso.ai/whatsapp/setup/dedicated",
            whatsapp_setup_error: null,
            whatsapp_setup_status: "pending",
          },
        }),
        { status: 201 },
      ),
    );
    const provider = createKapsoOnboardingProvider({
      apiKey: "kapso-secret",
      fetchImpl,
    });

    await provider.createSetupLink({
      allowedOrigin: "https://app.usepraxia.com",
      connectionType: "dedicated",
      customerId: "kapso-customer-1",
      failureRedirectUrl:
        "https://app.usepraxia.com/whatsapp/activacion/retorno",
      successRedirectUrl:
        "https://app.usepraxia.com/whatsapp/activacion/retorno",
    });

    const request = fetchImpl.mock.calls[0]?.[1];
    if (typeof request?.body !== "string") {
      throw new Error("Kapso no recibió el cuerpo JSON del enlace");
    }
    expect(request.body).toContain('"allowed_connection_types":["dedicated"]');
    expect(request.body).toContain('"meta_billing_mode":"partner_managed"');
    expect(request.body).toContain('"provision_phone_number":false');
  });

  it("lista los enlaces del customer sin devolver tokens", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              created_at: "2026-09-07T12:00:00.000Z",
              expires_at: "2026-10-07T12:00:00.000Z",
              id: "setup-link-1",
              status: "active",
              token: "must-not-cross-the-boundary",
              url: "https://app.kapso.ai/whatsapp/setup/opaque-link",
              whatsapp_setup_error: "access_token=must-not-cross-boundary",
              whatsapp_setup_status: "pending",
            },
          ],
          meta: { page: 1, total_pages: 1 },
        }),
        { status: 200 },
      ),
    );
    const provider = createKapsoOnboardingProvider({
      apiKey: "kapso-secret",
      fetchImpl,
    });

    await expect(provider.listSetupLinks("kapso-customer-1")).resolves.toEqual([
      {
        createdAt: new Date("2026-09-07T12:00:00.000Z"),
        expiresAt: new Date("2026-10-07T12:00:00.000Z"),
        id: "setup-link-1",
        status: "active",
        url: "https://app.kapso.ai/whatsapp/setup/opaque-link",
        whatsappSetupError:
          "Kapso reportó un bloqueo durante la configuración.",
        whatsappSetupStatus: "pending",
      },
    ]);
    expect(JSON.stringify(fetchImpl.mock.results)).not.toContain(
      "access_token=must-not-cross-boundary",
    );
  });

  it("envía el mismo número al reconectar una configuración productiva", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            created_at: "2026-09-07T12:00:00.000Z",
            expires_at: "2026-10-07T12:00:00.000Z",
            id: "setup-link-reconnect",
            status: "active",
            url: "https://app.kapso.ai/whatsapp/setup/reconnect",
            whatsapp_setup_error: null,
            whatsapp_setup_status: "pending",
          },
        }),
        { status: 201 },
      ),
    );
    const provider = createKapsoOnboardingProvider({
      apiKey: "kapso-secret",
      fetchImpl,
    });

    await provider.createSetupLink({
      allowedOrigin: "https://app.usepraxia.com",
      customerId: "kapso-customer-1",
      failureRedirectUrl: "https://app.usepraxia.com/configuracion/whatsapp",
      reconnectPhoneNumber: "+50370000000",
      successRedirectUrl: "https://app.usepraxia.com/configuracion/whatsapp",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.kapso.ai/platform/v1/customers/kapso-customer-1/setup_links",
      expect.objectContaining({
        body: JSON.stringify({
          setup_link: {
            allowed_connection_types: ["coexistence"],
            allowed_origins: ["https://app.usepraxia.com"],
            failure_redirect_url:
              "https://app.usepraxia.com/configuracion/whatsapp",
            language: "es",
            meta_billing_mode: "partner_managed",
            provision_phone_number: false,
            reconnect_phone_number: "+50370000000",
            success_redirect_url:
              "https://app.usepraxia.com/configuracion/whatsapp",
          },
        }),
        method: "POST",
      }),
    );
  });

  it("normaliza processing como estado pendiente de provisión", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              created_at: "2026-09-07T12:00:00.000Z",
              expires_at: "2026-10-07T12:00:00.000Z",
              id: "setup-link-processing",
              status: "used",
              url: "https://app.kapso.ai/whatsapp/setup/processing",
              whatsapp_setup_error: null,
              whatsapp_setup_status: "processing",
            },
          ],
          meta: { page: 1, total_pages: 1 },
        }),
        { status: 200 },
      ),
    );
    const provider = createKapsoOnboardingProvider({
      apiKey: "kapso-secret",
      fetchImpl,
    });

    await expect(
      provider.listSetupLinks("kapso-customer-1"),
    ).resolves.toMatchObject([{ whatsappSetupStatus: "pending" }]);
  });

  it("rechaza una expiración de Kapso distinta a 30 días", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            created_at: "2026-09-07T12:00:00.000Z",
            expires_at: "2026-10-08T12:00:00.000Z",
            id: "setup-link-1",
            status: "active",
            url: "https://app.kapso.ai/whatsapp/setup/opaque-link",
            whatsapp_setup_error: null,
            whatsapp_setup_status: "pending",
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
      provider.createSetupLink({
        allowedOrigin: "https://app.usepraxia.com",
        customerId: "kapso-customer-1",
        failureRedirectUrl: "https://app.usepraxia.com/error",
        successRedirectUrl: "https://app.usepraxia.com/success",
      }),
    ).rejects.toThrow("expiración distinta");
  });

  it("revoca un enlace existente mediante el estado de Kapso", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            created_at: "2026-09-07T12:00:00.000Z",
            expires_at: "2026-10-07T12:00:00.000Z",
            id: "setup-link-1",
            status: "revoked",
            url: "https://app.kapso.ai/whatsapp/setup/opaque-link",
            whatsapp_setup_error: null,
            whatsapp_setup_status: "pending",
          },
        }),
        { status: 200 },
      ),
    );
    const provider = createKapsoOnboardingProvider({
      apiKey: "kapso-secret",
      fetchImpl,
    });

    await expect(
      provider.revokeSetupLink({
        customerId: "kapso-customer-1",
        setupLinkId: "setup-link-1",
      }),
    ).resolves.toMatchObject({ id: "setup-link-1", status: "revoked" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.kapso.ai/platform/v1/customers/kapso-customer-1/setup_links/setup-link-1",
      expect.objectContaining({
        body: JSON.stringify({ setup_link: { status: "revoked" } }),
        method: "PATCH",
      }),
    );
  });

  it("trata un setup link remoto inexistente como revocado", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
      );
    const provider = createKapsoOnboardingProvider({
      apiKey: "kapso-secret",
      fetchImpl,
    });

    await expect(
      provider.revokeSetupLink({
        customerId: "kapso-customer-1",
        setupLinkId: "setup-link-missing",
      }),
    ).resolves.toBeUndefined();
  });

  it("falla cerrado si una asociación de número no trae un número visible", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              customer_id: "kapso-customer-1",
              phone_number_id: "phone-without-display-number",
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

    await expect(provider.listPhoneNumbers()).rejects.toThrow(
      "Kapso devolvió una respuesta inválida",
    );
  });
});
