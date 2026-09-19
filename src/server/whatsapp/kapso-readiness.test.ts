import { describe, expect, it, vi } from "vitest";

import {
  createKapsoReadinessProvider,
  KapsoReadinessProviderError,
} from "./kapso-readiness";

const templateNames = [
  "appointment_confirmation",
  "appointment_reminder",
  "appointment_cancellation",
  "appointment_reschedule",
];

describe("adaptador de readiness de Kapso", () => {
  it("sincroniza desde producción, normaliza Submitted a PENDING y conserva rechazo/deshabilitación", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ account_mode: "LIVE" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { status: "healthy" } })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                category: "UTILITY",
                components: [
                  {
                    text: "Hola {{patient_name}}, tu cita en {{clinic_name}} es el {{appointment_date}} a las {{appointment_time}} con {{doctor_name}}.",
                    type: "BODY",
                  },
                ],
                id: "template-confirmation",
                language: "es",
                name: templateNames[0],
                status: "APPROVED",
              },
              {
                components: [],
                category: "UTILITY",
                id: "template-reminder",
                language: "en_US",
                name: templateNames[1],
                status: "Submitted",
              },
            ],
            paging: { cursors: { after: "cursor-2" } },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                components: [],
                category: "UTILITY",
                id: "template-reminder-es",
                language: "es",
                name: templateNames[1],
                status: "APPROVED",
              },
              {
                components: [],
                category: "UTILITY",
                id: "template-cancellation",
                language: "es",
                name: templateNames[2],
                rejected_reason: "La categoría no corresponde",
                status: "REJECTED",
              },
              {
                components: [],
                category: "UTILITY",
                id: "template-reschedule",
                language: "es",
                name: templateNames[3],
                reason: "Pausada por Meta",
                status: "DISABLED",
              },
            ],
            paging: { cursors: { after: null } },
          }),
        ),
      );
    const provider = createKapsoReadinessProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
    });

    const result = await provider.syncTemplates({
      businessAccountId: "waba-1",
      phoneNumberId: "phone-1",
    });

    expect(result.numberEnvironment).toBe("production");
    expect(result.numberHealth).toBe("healthy");
    expect(result.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "UTILITY",
          kind: "confirmation",
          status: "APPROVED",
          variables: [
            "patient_name",
            "clinic_name",
            "appointment_date",
            "appointment_time",
            "doctor_name",
          ],
        }),
        expect.objectContaining({
          kind: "reminder",
          locale: "es",
          status: "APPROVED",
        }),
        expect.objectContaining({
          kind: "cancellation",
          rejectionReason: "La categoría no corresponde",
          status: "REJECTED",
        }),
        expect.objectContaining({
          kind: "reschedule",
          rejectionReason: "Pausada por Meta",
          status: "DISABLED",
        }),
      ]),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/phone-1/health",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://api.kapso.ai/meta/whatsapp/v24.0/waba-1/message_templates",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      "https://api.kapso.ai/meta/whatsapp/v24.0/waba-1/message_templates?after=cursor-2",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.kapso.ai/meta/whatsapp/v24.0/phone-1?fields=account_mode",
      expect.objectContaining({ method: "GET" }),
    );
    expect(JSON.stringify(fetchImpl.mock.results)).not.toContain(
      "access_token",
    );
  });

  it("no llama al sync para un número SANDBOX", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ account_mode: "SANDBOX" })),
      );
    const provider = createKapsoReadinessProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
    });

    await expect(
      provider.syncTemplates({
        businessAccountId: "waba-1",
        phoneNumberId: "phone-1",
      }),
    ).resolves.toMatchObject({
      numberEnvironment: "sandbox",
      templates: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("mantiene fuera de readiness un número productivo con salud UNHEALTHY", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ account_mode: "LIVE" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { status: "unhealthy" } })),
      );
    const provider = createKapsoReadinessProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
    });

    await expect(
      provider.syncTemplates({
        businessAccountId: "waba-1",
        phoneNumberId: "phone-1",
      }),
    ).resolves.toMatchObject({
      numberEnvironment: "production",
      numberHealth: "unhealthy",
      templates: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("mantiene pendiente un ambiente que Kapso no pudo identificar", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({})));
    const provider = createKapsoReadinessProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
    });

    const result = await provider.syncTemplates({
      businessAccountId: "waba-1",
      phoneNumberId: "phone-1",
    });

    expect(result.numberEnvironment).toBe("unknown");
    expect(result.templates).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("lee billing operativo sin traer credenciales y ejecuta la prueba del webhook", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              alert_threshold_usd: "1.00",
              charges_separated: true,
              attributed_consumption_usd: "2.50",
              credit_balance_usd: "10.00",
              monthly_message_quota: 100,
              messages_used: 4,
              meta_charges_usd: "1.50",
              meta_billing_mode: "partner_managed",
              platform_charges_usd: "1.00",
              quota_period: "2026-09-01T00:00:00Z",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { success: true } })),
      );
    const provider = createKapsoReadinessProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
    });

    await expect(
      provider.getBilling({
        businessAccountId: "waba-1",
        phoneNumberId: "phone-1",
      }),
    ).resolves.toEqual({
      alertThresholdCents: 100,
      chargesSeparated: true,
      consumedCents: 250,
      creditCents: 1_000,
      kapsoMonthlyQuota: 100,
      kapsoQuotaConsumed: 4,
      kapsoQuotaPeriod: "2026-09",
      metaChargesCents: 150,
      mode: "partner_managed",
      platformChargesCents: 100,
      status: "ready",
    });
    const e2eResult = await provider.runE2ETest({
      phoneNumberId: "phone-1",
      projectWebhookId: "project-webhook-1",
    });
    expect(e2eResult.evidence).toContain("success");
    expect(e2eResult.evidenceScope).toBe("webhook-preflight");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/phone-1/billing?waba_id=waba-1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.kapso.ai/platform/v1/whatsapp/webhooks/project-webhook-1/test",
      expect.objectContaining({
        body: "{}",
        method: "POST",
      }),
    );
  });

  it("convierte la respuesta HTTP y el tiempo de espera en un error de proveedor sin payload crudo", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("down"));
    const provider = createKapsoReadinessProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
    });

    await expect(
      provider.getBilling({
        businessAccountId: "waba-1",
        phoneNumberId: "phone-1",
      }),
    ).rejects.toBeInstanceOf(KapsoReadinessProviderError);
  });

  it("usa el contrato oficial de prueba de webhook y conserva el smoke app-side en Praxia", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            success: true,
          },
        }),
      ),
    );
    const provider = createKapsoReadinessProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
    });

    const result = await provider.runSyntheticSmoke?.({
      phoneNumberId: "phone-92",
      projectWebhookId: "project-webhook-92",
      syntheticContactId: "synthetic-contact-92",
    });

    expect(result?.syntheticContact).toBe(true);
    expect(result?.providerTransportVerified).toBe(false);
    expect(result?.realPatientsEnabled).toBe(false);
    expect(result?.steps).toEqual({});
    expect(result?.evidence).toContain("success=true");
    const requestInit = fetchImpl.mock.calls[0]?.[1];
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.kapso.ai/platform/v1/whatsapp/webhooks/project-webhook-92/test",
      expect.anything(),
    );
    expect(requestInit?.method).toBe("POST");
    expect(typeof requestInit?.body).toBe("string");
    if (typeof requestInit?.body !== "string") return;
    expect(JSON.parse(requestInit.body)).toEqual({
      event_type: "whatsapp.phone_number.created",
    });
  });

  it("falla cerrado si Kapso no confirma que la prueba del webhook fue encolada", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            success: false,
          },
        }),
      ),
    );
    const provider = createKapsoReadinessProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
    });

    await expect(
      provider.runSyntheticSmoke?.({
        phoneNumberId: "phone-92",
        projectWebhookId: "project-webhook-92",
        syntheticContactId: "synthetic-contact-92",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("mantiene billing pendiente si Kapso no devuelve umbral de alerta", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            charges_separated: true,
            attributed_consumption_usd: "2.50",
            credit_balance_usd: "10.00",
            meta_billing_mode: "partner_managed",
          },
        }),
      ),
    );
    const provider = createKapsoReadinessProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
    });

    await expect(
      provider.getBilling({
        businessAccountId: "waba-1",
        phoneNumberId: "phone-1",
      }),
    ).resolves.toMatchObject({ status: "pending" });
  });
});
