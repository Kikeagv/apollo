import { describe, expect, it, vi } from "vitest";

import {
  KapsoProvisioningProviderError,
  createKapsoProvisioningProvider,
} from "./kapso-provisioning";

describe("adaptador de provisión de Kapso", () => {
  it("lee el número por phone_number_id y conserva solo identificadores operativos", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            access_token: "no-debe-cruzar-la-frontera",
            business_account_id: "waba-1",
            customer_id: "customer-1",
            display_phone_number: "+503 7000 0000",
            phone_number_id: "phone-1",
          },
        }),
      ),
    );
    const provider = createKapsoProvisioningProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
      secretKey: "webhook-secret",
      webhookUrl: "https://app.usepraxia.com/api/webhooks/kapso",
    });

    await expect(provider.getPhoneNumber("phone-1")).resolves.toEqual({
      businessAccountId: "waba-1",
      customerId: "customer-1",
      displayPhoneE164: "+50370000000",
      phoneNumberId: "phone-1",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/phone-1",
      expect.objectContaining({
        headers: { "X-API-Key": "kapso-api-key" },
        method: "GET",
      }),
    );
    expect(JSON.stringify(fetchImpl.mock.results)).not.toContain(
      "access_token",
    );
  });

  it("crea el webhook de proyecto solo cuando no existe uno equivalente", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                active: true,
                events: ["whatsapp.phone_number.created"],
                id: "project-webhook-old",
                kind: "kapso",
                phone_number_id: null,
                url: "https://other.example/webhook",
              },
            ],
            meta: { page: 1, total_pages: 1 },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              active: true,
              events: [
                "whatsapp.phone_number.created",
                "whatsapp.phone_number.deleted",
              ],
              id: "project-webhook-new",
              kind: "kapso",
              phone_number_id: null,
              url: "https://app.usepraxia.com/api/webhooks/kapso",
            },
          }),
          { status: 201 },
        ),
      );
    const provider = createKapsoProvisioningProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
      secretKey: "webhook-secret",
      webhookUrl: "https://app.usepraxia.com/api/webhooks/kapso",
    });

    await expect(provider.ensureProjectWebhook()).resolves.toEqual({
      remoteId: "project-webhook-new",
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.kapso.ai/platform/v1/whatsapp/webhooks",
      expect.objectContaining({
        body: JSON.stringify({
          whatsapp_webhook: {
            active: true,
            events: [
              "whatsapp.phone_number.created",
              "whatsapp.phone_number.deleted",
            ],
            secret_key: "webhook-secret",
            url: "https://app.usepraxia.com/api/webhooks/kapso",
          },
        }),
        method: "POST",
      }),
    );
  });

  it("recupera un POST ambiguo cuando Kapso ya creó el webhook", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [], meta: { total_pages: 1 } })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "timeout" }), { status: 504 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                active: true,
                events: [
                  "whatsapp.phone_number.created",
                  "whatsapp.phone_number.deleted",
                ],
                id: "project-webhook-recovered",
                kind: "kapso",
                phone_number_id: null,
                url: "https://app.usepraxia.com/api/webhooks/kapso",
              },
            ],
            meta: { total_pages: 1 },
          }),
        ),
      );
    const provider = createKapsoProvisioningProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
      secretKey: "webhook-secret",
      webhookUrl: "https://app.usepraxia.com/api/webhooks/kapso",
    });

    await expect(provider.ensureProjectWebhook()).resolves.toEqual({
      remoteId: "project-webhook-recovered",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("recupera un conflicto ambiguo al crear el webhook de número", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [], meta: { total_pages: 1 } })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "already exists" }), {
          status: 409,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                active: true,
                buffer_enabled: false,
                events: [
                  "whatsapp.message.received",
                  "whatsapp.message.sent",
                  "whatsapp.message.delivered",
                  "whatsapp.message.read",
                  "whatsapp.message.failed",
                  "whatsapp.conversation.created",
                  "whatsapp.conversation.ended",
                  "whatsapp.conversation.inactive",
                ],
                id: "phone-webhook-recovered",
                kind: "kapso",
                phone_number_id: "phone-1",
                url: "https://app.usepraxia.com/api/webhooks/kapso",
              },
            ],
            meta: { total_pages: 1 },
          }),
        ),
      );
    const provider = createKapsoProvisioningProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
      secretKey: "webhook-secret",
      webhookUrl: "https://app.usepraxia.com/api/webhooks/kapso",
    });

    await expect(provider.ensurePhoneNumberWebhook("phone-1")).resolves.toEqual(
      { remoteId: "phone-webhook-recovered" },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("trata una respuesta 2xx inválida como creación ambigua y reintentable", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [], meta: { total_pages: 1 } })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 201 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [], meta: { total_pages: 1 } })),
      );
    const provider = createKapsoProvisioningProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
      secretKey: "webhook-secret",
      webhookUrl: "https://app.usepraxia.com/api/webhooks/kapso",
    });

    await expect(provider.ensureProjectWebhook()).rejects.toMatchObject({
      status: 0,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("confirma el webhook de número existente sin crear un duplicado y exige no buffering", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              active: true,
              buffer_enabled: false,
              events: [
                "whatsapp.message.received",
                "whatsapp.message.sent",
                "whatsapp.message.delivered",
                "whatsapp.message.read",
                "whatsapp.message.failed",
                "whatsapp.conversation.created",
                "whatsapp.conversation.ended",
                "whatsapp.conversation.inactive",
              ],
              id: "phone-webhook-1",
              kind: "kapso",
              phone_number_id: "phone-1",
              url: "https://app.usepraxia.com/api/webhooks/kapso",
            },
          ],
          meta: { page: 1, total_pages: 1 },
        }),
      ),
    );
    const provider = createKapsoProvisioningProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
      secretKey: "webhook-secret",
      webhookUrl: "https://app.usepraxia.com/api/webhooks/kapso",
    });

    await expect(provider.ensurePhoneNumberWebhook("phone-1")).resolves.toEqual(
      { remoteId: "phone-webhook-1" },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("convierte un 503 en un error clasificable para reintento", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
      );
    const provider = createKapsoProvisioningProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
      secretKey: "webhook-secret",
      webhookUrl: "https://app.usepraxia.com/api/webhooks/kapso",
    });

    await expect(provider.getPhoneNumber("phone-1")).rejects.toBeInstanceOf(
      KapsoProvisioningProviderError,
    );
  });
});
