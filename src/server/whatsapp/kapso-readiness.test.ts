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

  it("conserva el contenido remoto de una plantilla existente", async () => {
    const remoteContent = "Contenido obsoleto: {{patient_name}}";
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
                components: [{ text: remoteContent, type: "BODY" }],
                id: "old-confirmation",
                language: "es",
                name: templateNames[0],
                status: "APPROVED",
              },
              {
                category: "UTILITY",
                components: [],
                id: "missing-body-reminder",
                language: "es",
                name: templateNames[1],
                status: "APPROVED",
              },
              {
                components: [
                  { text: "Contenido remoto de cancelación", type: "BODY" },
                ],
                id: "missing-category-cancellation",
                language: "es",
                name: templateNames[2],
                status: "APPROVED",
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              category: "UTILITY",
              components: [
                { text: "Contenido de reprogramación", type: "BODY" },
              ],
              id: "created-reschedule",
              language: "es",
              name: templateNames[3],
              status: "PENDING",
            },
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

    expect(
      result.templates.find((template) => template.kind === "confirmation"),
    ).toMatchObject({
      content: remoteContent,
      status: "APPROVED",
      variables: ["patient_name"],
    });
    expect(
      result.templates.find((template) => template.kind === "reminder"),
    ).toMatchObject({
      content: "",
      status: "APPROVED",
      variables: [],
    });
    expect(
      result.templates.find((template) => template.kind === "cancellation"),
    ).toMatchObject({ category: null });
  });

  it("conserva la definición del catálogo al aceptar una respuesta mínima de creación", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ account_mode: "LIVE" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { status: "healthy" } })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "created-confirmation",
              language: "es",
              name: templateNames[0],
              status: "PENDING",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "created-reminder",
              name: templateNames[1],
              status: "PENDING",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "created-cancellation",
              name: templateNames[2],
              status: "PENDING",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "created-reschedule",
              name: templateNames[3],
              status: "PENDING",
            },
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

    expect(
      result.templates.find((template) => template.kind === "confirmation"),
    ).toMatchObject({
      category: "UTILITY",
      catalogVersion: 1,
      content:
        "Hola {{patient_name}}, tu cita en {{clinic_name}} es el {{appointment_date}} a las {{appointment_time}} con {{doctor_name}}.",
      examples: {
        appointment_date: "25 de septiembre de 2026",
        appointment_time: "08:30",
        clinic_name: "Clínica Central",
        doctor_name: "Dra. Ana López",
        patient_name: "María Hernández",
      },
      locale: "es",
      provisioningStatus: "submitted",
      variables: [
        "patient_name",
        "clinic_name",
        "appointment_date",
        "appointment_time",
        "doctor_name",
      ],
    });
  });

  it("conserva un estado aprobado que ya devuelve la creación remota", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ account_mode: "LIVE" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { status: "healthy" } })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "created-approved-confirmation",
              language: "es",
              name: templateNames[0],
              status: "APPROVED",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "created-reminder",
              name: templateNames[1],
              status: "PENDING",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "created-cancellation",
              name: templateNames[2],
              status: "PENDING",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "created-reschedule",
              name: templateNames[3],
              status: "PENDING",
            },
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

    expect(
      result.templates.find((template) => template.kind === "confirmation"),
    ).toMatchObject({
      providerTemplateId: "created-approved-confirmation",
      provisioningStatus: "approved",
      status: "APPROVED",
    });
  });

  it("recupera una plantilla creada concurrentemente tras un conflicto de nombre", async () => {
    const confirmation =
      "Hola {{patient_name}}, tu cita en {{clinic_name}} es el {{appointment_date}} a las {{appointment_time}} con {{doctor_name}}.";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ account_mode: "LIVE" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { status: "healthy" } })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: "El nombre de la plantilla ya existe" },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                category: "UTILITY",
                components: [{ text: confirmation, type: "BODY" }],
                id: "existing-confirmation",
                language: "es",
                name: templateNames[0],
                status: "APPROVED",
              },
            ],
          }),
        ),
      )
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                id: "created-template",
                name: "created-template",
                status: "PENDING",
              },
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

    expect(
      result.templates.find((template) => template.kind === "confirmation"),
    ).toMatchObject({
      providerTemplateId: "existing-confirmation",
      provisioningStatus: "approved",
      status: "APPROVED",
    });
    expect(
      fetchImpl.mock.calls.filter(
        ([url, init]) =>
          typeof url === "string" &&
          url.endsWith("/message_templates") &&
          init?.method === "POST",
      ),
    ).toHaveLength(4);
  });

  it("conserva la causa de rechazo anidada que devuelve el proveedor", async () => {
    const rejectionReason = "La plantilla incumple la política de contenido";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ account_mode: "LIVE" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { status: "healthy" } })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              error: { message: rejectionReason, type: "OAuthException" },
            }),
            { status: 400 },
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

    expect(
      result.templates.find((template) => template.kind === "confirmation"),
    ).toMatchObject({
      provisioningStatus: "rejected",
      rejectionReason,
      status: "REJECTED",
    });
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
    const preflight = result?.steps["webhook-preflight"];
    expect(preflight?.evidence).toContain(
      "event_type=whatsapp.phone_number.created",
    );
    expect(preflight?.passed).toBe(true);
    expect(preflight?.source).toBe("provider");
    expect(preflight?.status).toBe("passed");
    expect(result?.steps["real-delivery"]).toBeUndefined();
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
