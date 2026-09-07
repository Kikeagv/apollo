import { z } from "zod";

import {
  kapsoPhoneNumberWebhookEvents,
  kapsoProjectWebhookEvents,
} from "~/domain/whatsapp-kapso-provisioning";
import type {
  KapsoProvisioningPhoneNumber,
  KapsoProvisioningProvider,
} from "~/server/application/whatsapp-provisioning";
import { KapsoProvisioningProviderError } from "~/server/application/whatsapp-provisioning";

export { KapsoProvisioningProviderError } from "~/server/application/whatsapp-provisioning";

const KAPSO_PLATFORM_API_URL = "https://api.kapso.ai/platform/v1";
const KAPSO_REQUEST_TIMEOUT_MS = 10_000;

const webhookSchema = z.object({
  active: z.boolean().optional(),
  buffer_enabled: z.boolean().optional(),
  events: z.array(z.string()),
  id: z.string(),
  kind: z.string().optional(),
  phone_number_id: z.string().nullable().optional(),
  url: z.string().url(),
});

const phoneNumberSchema = z.object({
  business_account_id: z.string().nullable().optional(),
  customer_id: z.string(),
  display_phone_number: z.string().nullable().optional(),
  display_phone_number_normalized: z.string().nullable().optional(),
  phone_number_id: z.string(),
});

const listResponseSchema = z.object({
  data: z.array(webhookSchema),
  meta: z
    .object({ total_pages: z.number().int().positive().optional() })
    .optional(),
});

const webhookResponseSchema = z.object({ data: webhookSchema });
const phoneNumberResponseSchema = z.object({ data: phoneNumberSchema });
type KapsoWebhook = z.infer<typeof webhookSchema>;

export class KapsoProvisioningProviderUnavailableError extends Error {
  constructor() {
    super("Kapso no está disponible para la provisión");
    this.name = "KapsoProvisioningProviderUnavailableError";
  }
}

type KapsoProvisioningProviderOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  secretKey?: string;
  webhookUrl: string;
};

export function createKapsoProvisioningProvider(
  options: KapsoProvisioningProviderOptions,
): KapsoProvisioningProvider {
  const fetchImpl = options.fetchImpl ?? fetch;

  assertConfigured(options);

  return {
    async ensurePhoneNumberWebhook(phoneNumberId) {
      const webhooks = await listWebhooks(
        fetchImpl,
        options.apiKey,
        `/whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}/webhooks`,
      );
      const matching = webhooks.find(
        (webhook) =>
          webhook.kind !== "meta" &&
          webhook.active !== false &&
          webhook.buffer_enabled === false &&
          webhook.url === options.webhookUrl &&
          includesAll(webhook.events, kapsoPhoneNumberWebhookEvents),
      );
      if (matching !== undefined) return { remoteId: matching.id };

      const existing = webhooks.find(
        (webhook) =>
          webhook.kind !== "meta" &&
          webhook.url === options.webhookUrl &&
          webhook.phone_number_id === phoneNumberId,
      );
      if (existing !== undefined) {
        const updated = await requestJson(
          fetchImpl,
          options.apiKey,
          `/whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}/webhooks/${encodeURIComponent(existing.id)}`,
          {
            body: JSON.stringify({
              whatsapp_webhook: phoneWebhookInput(options),
            }),
            headers: { "Content-Type": "application/json" },
            method: "PATCH",
          },
        );
        return {
          remoteId: parseWebhookResponse(updated).id,
        };
      }

      return createWebhookAndRecover({
        apiKey: options.apiKey,
        body: JSON.stringify({
          whatsapp_webhook: phoneWebhookInput(options),
        }),
        createPath: `/whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}/webhooks`,
        fetchImpl,
        matches: (webhook) =>
          webhook.kind !== "meta" &&
          webhook.active !== false &&
          webhook.buffer_enabled === false &&
          webhook.url === options.webhookUrl &&
          webhook.phone_number_id === phoneNumberId &&
          includesAll(webhook.events, kapsoPhoneNumberWebhookEvents),
        listPath: `/whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}/webhooks`,
      });
    },

    async ensureProjectWebhook() {
      const webhooks = await listWebhooks(
        fetchImpl,
        options.apiKey,
        "/whatsapp/webhooks",
      );
      const matching = webhooks.find(
        (webhook) =>
          webhook.kind !== "meta" &&
          webhook.active !== false &&
          webhook.phone_number_id == null &&
          webhook.url === options.webhookUrl &&
          includesAll(webhook.events, kapsoProjectWebhookEvents),
      );
      if (matching !== undefined) return { remoteId: matching.id };

      const existing = webhooks.find(
        (webhook) =>
          webhook.kind !== "meta" &&
          webhook.phone_number_id == null &&
          webhook.url === options.webhookUrl,
      );
      if (existing !== undefined) {
        const updated = await requestJson(
          fetchImpl,
          options.apiKey,
          `/whatsapp/webhooks/${encodeURIComponent(existing.id)}`,
          {
            body: JSON.stringify({
              whatsapp_webhook: projectWebhookInput(options),
            }),
            headers: { "Content-Type": "application/json" },
            method: "PATCH",
          },
        );
        return {
          remoteId: parseWebhookResponse(updated).id,
        };
      }

      return createWebhookAndRecover({
        apiKey: options.apiKey,
        body: JSON.stringify({
          whatsapp_webhook: projectWebhookInput(options),
        }),
        createPath: "/whatsapp/webhooks",
        fetchImpl,
        matches: (webhook) =>
          webhook.kind !== "meta" &&
          webhook.active !== false &&
          webhook.phone_number_id == null &&
          webhook.url === options.webhookUrl &&
          includesAll(webhook.events, kapsoProjectWebhookEvents),
        listPath: "/whatsapp/webhooks",
      });
    },

    async getPhoneNumber(phoneNumberId) {
      try {
        const payload = await requestJson(
          fetchImpl,
          options.apiKey,
          `/whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}`,
          { method: "GET" },
        );
        const phoneNumber = phoneNumberResponseSchema.parse(payload).data;
        return toPhoneNumber(phoneNumber);
      } catch (error) {
        if (
          error instanceof KapsoProvisioningProviderError &&
          error.status === 404
        ) {
          return undefined;
        }
        throw error;
      }
    },
  };
}

function assertConfigured(options: KapsoProvisioningProviderOptions) {
  if (
    options.apiKey === undefined ||
    options.apiKey.trim() === "" ||
    options.secretKey === undefined ||
    options.secretKey.trim() === "" ||
    options.webhookUrl.trim() === ""
  ) {
    throw new KapsoProvisioningProviderUnavailableError();
  }
}

function projectWebhookInput(options: KapsoProvisioningProviderOptions) {
  return {
    active: true,
    events: [...kapsoProjectWebhookEvents],
    secret_key: options.secretKey,
    url: options.webhookUrl,
  };
}

function phoneWebhookInput(options: KapsoProvisioningProviderOptions) {
  return {
    active: true,
    buffer_enabled: false,
    events: [...kapsoPhoneNumberWebhookEvents],
    secret_key: options.secretKey,
    url: options.webhookUrl,
  };
}

async function listWebhooks(
  fetchImpl: typeof fetch,
  apiKey: string | undefined,
  path: string,
) {
  const webhooks: z.infer<typeof webhookSchema>[] = [];
  let page = 1;
  while (true) {
    const query = new URLSearchParams({ page: String(page), per_page: "100" });
    const payload = await requestJson(
      fetchImpl,
      apiKey,
      `${path}?${query.toString()}`,
      { method: "GET" },
    );
    const response = listResponseSchema.parse(payload);
    webhooks.push(...response.data);
    const totalPages = response.meta?.total_pages ?? page;
    if (page >= totalPages) return webhooks;
    page += 1;
  }
}

async function createWebhookAndRecover(input: {
  apiKey: string | undefined;
  body: string;
  createPath: string;
  fetchImpl: typeof fetch;
  listPath: string;
  matches: (webhook: KapsoWebhook) => boolean;
}) {
  try {
    const created = await requestJson(
      input.fetchImpl,
      input.apiKey,
      input.createPath,
      {
        body: input.body,
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    return { remoteId: parseWebhookResponse(created).id };
  } catch (error) {
    if (!isAmbiguousCreateError(error)) throw error;

    try {
      const recovered = (
        await listWebhooks(input.fetchImpl, input.apiKey, input.listPath)
      ).find(input.matches);
      if (recovered !== undefined) return { remoteId: recovered.id };
    } catch {
      // Conserva el error del POST; el siguiente job volverá a reconciliar.
    }
    throw retryableCreateError(error);
  }
}

function isAmbiguousCreateError(error: unknown) {
  if (error instanceof z.ZodError) return true;
  return (
    error instanceof KapsoProvisioningProviderError &&
    (error.status === 0 ||
      error.status === 408 ||
      error.status === 409 ||
      error.status >= 500 ||
      (error.status >= 200 && error.status < 300))
  );
}

function retryableCreateError(error: unknown) {
  if (error instanceof KapsoProvisioningProviderError && error.status === 0) {
    return error;
  }
  return new KapsoProvisioningProviderError(
    0,
    error instanceof Error
      ? `No se pudo confirmar la creación del webhook: ${error.message}`
      : "No se pudo confirmar la creación del webhook",
  );
}

async function requestJson(
  fetchImpl: typeof fetch,
  apiKey: string | undefined,
  path: string,
  init: RequestInit,
) {
  const url = `${KAPSO_PLATFORM_API_URL}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    KAPSO_REQUEST_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        "X-API-Key": apiKey ?? "",
      },
      signal: controller.signal,
    });
  } catch (error) {
    throw new KapsoProvisioningProviderError(
      0,
      error instanceof Error ? error.message : "Kapso no respondió",
    );
  } finally {
    clearTimeout(timeout);
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new KapsoProvisioningProviderError(
      0,
      error instanceof Error ? error.message : "Kapso no respondió",
    );
  }
  let payload: unknown = {};
  if (text !== "") {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new KapsoProvisioningProviderError(
        response.status,
        "Kapso devolvió una respuesta inválida",
      );
    }
  }
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "Kapso rechazó la provisión";
    throw new KapsoProvisioningProviderError(response.status, message);
  }
  return payload;
}

function parseWebhookResponse(payload: unknown) {
  return webhookResponseSchema.parse(payload).data;
}

function toPhoneNumber(
  phoneNumber: z.infer<typeof phoneNumberSchema>,
): KapsoProvisioningPhoneNumber {
  return {
    businessAccountId: phoneNumber.business_account_id ?? null,
    customerId: phoneNumber.customer_id,
    displayPhoneE164: normalizePhoneNumber(
      phoneNumber.display_phone_number_normalized ??
        phoneNumber.display_phone_number ??
        null,
    ),
    phoneNumberId: phoneNumber.phone_number_id,
  };
}

function normalizePhoneNumber(value: string | null) {
  if (value === null) return null;
  const normalized = value.replace(/[\s().-]/g, "");
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

function includesAll<T extends string>(
  values: string[],
  expected: readonly T[],
) {
  return expected.every((event) => values.includes(event));
}
