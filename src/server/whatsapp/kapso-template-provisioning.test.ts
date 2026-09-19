import { describe, expect, it, vi } from "vitest";

import { whatsappCriticalTemplateCatalog } from "~/domain/whatsapp-readiness";

import { createKapsoReadinessProvider } from "./kapso-readiness";

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") {
    throw new Error("el request no tiene un body JSON");
  }
  const parsed = JSON.parse(init.body) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("el body no es un objeto JSON");
  }
  return parsed as Record<string, unknown>;
}

function requestTemplateName(init: RequestInit | undefined) {
  const body = requestBody(init);
  if (typeof body.name !== "string") {
    throw new Error("el body no tiene nombre de plantilla");
  }
  return body.name;
}

function createdTemplateResponse(
  definition: (typeof whatsappCriticalTemplateCatalog)[number],
  id: string,
) {
  return new Response(
    JSON.stringify({
      data: {
        category: definition.category,
        components: [
          {
            example: {
              body_text_named_params: definition.variables.map((paramName) => ({
                example: definition.examples[paramName],
                param_name: paramName,
              })),
            },
            text: definition.content,
            type: "BODY",
          },
        ],
        id,
        language: definition.locale,
        name: definition.name,
        status: "PENDING",
      },
    }),
    { status: 200 },
  );
}

describe("provisionamiento de plantillas de Kapso", () => {
  it("consulta el WABA y crea sólo las definiciones faltantes con ejemplos nombrados", async () => {
    const missing = whatsappCriticalTemplateCatalog.slice(1);
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
                  { text: whatsappCriticalTemplateCatalog[0]?.content },
                ],
                id: "template-existing",
                language: "es",
                name: whatsappCriticalTemplateCatalog[0]?.name,
                status: "APPROVED",
              },
            ],
          }),
        ),
      )
      .mockImplementation(async (_input, init) => {
        const name = requestTemplateName(init);
        const definition = missing.find((candidate) => candidate.name === name);
        if (definition === undefined) throw new Error("plantilla inesperada");
        return createdTemplateResponse(
          definition,
          `template-${definition.kind}`,
        );
      });

    const provider = createKapsoReadinessProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
    });

    const result = await provider.syncTemplates({
      businessAccountId: "waba-1",
      phoneNumberId: "phone-1",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(
      fetchImpl.mock.calls.slice(3).map(([url, init]) => ({
        body: requestBody(init),
        method: init?.method,
        url,
      })),
    ).toEqual(
      missing.map((definition) => ({
        body: {
          category: definition.category,
          components: [
            {
              example: {
                body_text_named_params: definition.variables.map(
                  (paramName) => ({
                    example: definition.examples[paramName],
                    param_name: paramName,
                  }),
                ),
              },
              text: definition.content,
              type: "BODY",
            },
          ],
          language: definition.locale,
          name: definition.name,
          parameter_format: "NAMED",
        },
        method: "POST",
        url: `https://api.kapso.ai/meta/whatsapp/v24.0/waba-1/message_templates`,
      })),
    );
    expect(result.templates).toHaveLength(4);
    expect(
      result.templates.find((template) => template.kind === "confirmation"),
    ).toMatchObject({
      providerTemplateId: "template-existing",
      provisioningStatus: "approved",
    });
    for (const definition of missing) {
      expect(
        result.templates.find((template) => template.kind === definition.kind),
      ).toMatchObject({
        providerTemplateId: `template-${definition.kind}`,
        provisioningStatus: "submitted",
      });
    }
  });

  it("reconcilia una respuesta ambigua consultando el WABA antes de reintentar", async () => {
    const missingDefinition = whatsappCriticalTemplateCatalog[1];
    if (missingDefinition === undefined) throw new Error("catálogo incompleto");
    const existing = whatsappCriticalTemplateCatalog
      .filter((definition) => definition.kind !== missingDefinition.kind)
      .map((definition) => ({
        category: definition.category,
        components: [{ text: definition.content }],
        id: `existing-${definition.kind}`,
        language: definition.locale,
        name: definition.name,
        status: "APPROVED",
      }));
    const recovered = {
      category: missingDefinition.category,
      components: [{ text: missingDefinition.content }],
      id: "recovered-reminder",
      language: missingDefinition.locale,
      name: missingDefinition.name,
      status: "PENDING",
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ account_mode: "LIVE" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { status: "healthy" } })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: existing })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "timeout" }), { status: 500 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [...existing, recovered] })),
      );

    const provider = createKapsoReadinessProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
    });

    const result = await provider.syncTemplates({
      businessAccountId: "waba-1",
      phoneNumberId: "phone-1",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(
      result.templates.find((template) => template.kind === "reminder"),
    ).toMatchObject({
      providerTemplateId: "recovered-reminder",
      provisioningStatus: "submitted",
    });
  });

  it("trata como faltante el mismo nombre registrado con otro locale", async () => {
    const confirmation = whatsappCriticalTemplateCatalog[0];
    if (confirmation === undefined) throw new Error("catálogo incompleto");
    const remoteTemplates = whatsappCriticalTemplateCatalog.map(
      (definition) => ({
        category: definition.category,
        components: [{ text: definition.content }],
        id: `existing-${definition.kind}`,
        language:
          definition.kind === "confirmation" ? "en_US" : definition.locale,
        name: definition.name,
        status: "APPROVED",
      }),
    );
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ account_mode: "LIVE" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { status: "healthy" } })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: remoteTemplates })),
      )
      .mockImplementation(async (_input, init) => {
        const name = requestTemplateName(init);
        return createdTemplateResponse(confirmation, `created-${name}`);
      });

    const provider = createKapsoReadinessProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
    });
    const result = await provider.syncTemplates({
      businessAccountId: "waba-1",
      phoneNumberId: "phone-1",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(requestBody(fetchImpl.mock.calls[3]?.[1])).toMatchObject({
      language: "es",
      name: confirmation.name,
    });
    expect(
      result.templates.find((template) => template.kind === "confirmation"),
    ).toMatchObject({
      providerTemplateId: "created-appointment_confirmation",
      provisioningStatus: "submitted",
    });
  });

  it("conserva el rechazo de una plantilla y continúa con las demás del WABA", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ account_mode: "LIVE" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { status: "healthy" } })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
      .mockImplementation(async (_input, init) => {
        const name = requestTemplateName(init);
        if (name === "appointment_confirmation") {
          return new Response(
            JSON.stringify({ error: "Nombre o contenido rechazado por Meta" }),
            { status: 422 },
          );
        }
        const definition = whatsappCriticalTemplateCatalog.find(
          (candidate) => candidate.name === name,
        );
        if (definition === undefined) throw new Error("plantilla inesperada");
        return createdTemplateResponse(
          definition,
          `created-${definition.kind}`,
        );
      });

    const provider = createKapsoReadinessProvider({
      apiKey: "kapso-api-key",
      fetchImpl,
    });
    const result = await provider.syncTemplates({
      businessAccountId: "waba-1",
      phoneNumberId: "phone-1",
    });

    expect(result.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "confirmation",
          provisioningStatus: "rejected",
          rejectionReason: "Nombre o contenido rechazado por Meta",
          status: "REJECTED",
        }),
        expect.objectContaining({
          kind: "reminder",
          provisioningStatus: "submitted",
        }),
      ]),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(7);
  });
});
