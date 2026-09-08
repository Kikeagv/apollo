import { z } from "zod";

import {
  whatsappCriticalTemplateCatalog,
  type WhatsAppNumberHealth,
  type WhatsAppTemplateCategory,
  type WhatsAppTemplateSnapshot,
} from "~/domain/whatsapp-readiness";
import type {
  WhatsAppBillingProviderResult,
  WhatsAppReadinessProvider,
  WhatsAppTemplateSyncResult,
} from "~/server/application/whatsapp-readiness";

const KAPSO_PLATFORM_API_URL = "https://api.kapso.ai/platform/v1";
const KAPSO_META_API_URL = "https://api.kapso.ai/meta/whatsapp/v24.0";
const KAPSO_REQUEST_TIMEOUT_MS = 10_000;

const jsonObjectSchema = z.record(z.string(), z.unknown());

export class KapsoReadinessProviderError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "KapsoReadinessProviderError";
    this.status = status;
  }
}

type KapsoReadinessProviderOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

/** Adaptador Kapso: solo cruza IDs, estados y evidencia operativa no secreta. */
export function createKapsoReadinessProvider(
  options: KapsoReadinessProviderOptions,
): WhatsAppReadinessProvider {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async syncTemplates(input): Promise<WhatsAppTemplateSyncResult> {
      const accountModePayload = await requestJson(
        fetchImpl,
        options.apiKey,
        `${KAPSO_META_API_URL}/${encodeURIComponent(input.phoneNumberId)}?fields=account_mode`,
        { baseUrl: "", method: "GET" },
      );
      const accountMode = readString(
        unwrapData(accountModePayload),
        "account_mode",
      );
      const numberEnvironment =
        accountMode?.toUpperCase() === "SANDBOX"
          ? "sandbox"
          : accountMode?.toUpperCase() === "LIVE" ||
              accountMode?.toUpperCase() === "PRODUCTION"
            ? "production"
            : "unknown";
      const syncedAt = new Date();
      if (numberEnvironment !== "production") {
        return {
          numberEnvironment,
          numberHealth: "unknown",
          numberHealthCheckedAt: null,
          syncedAt,
          templates: [],
        };
      }

      const health = await readNumberHealth(
        fetchImpl,
        options.apiKey,
        input.phoneNumberId,
      );
      const numberHealth = health.health;
      if (numberHealth !== "healthy") {
        return {
          numberEnvironment,
          numberHealth,
          numberHealthCheckedAt: health.checkedAt,
          syncedAt,
          templates: [],
        };
      }

      await requestJson(fetchImpl, options.apiKey, "/whatsapp_templates/sync", {
        body: JSON.stringify({ phone_number_id: input.phoneNumberId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        baseUrl: "https://api.kapso.ai",
      });
      const remoteTemplates = await listMessageTemplates(
        fetchImpl,
        options.apiKey,
        input.businessAccountId,
      );

      return {
        numberHealth,
        numberEnvironment,
        numberHealthCheckedAt: health.checkedAt,
        syncedAt,
        templates: whatsappCriticalTemplateCatalog.map((definition) => {
          const namedTemplates = remoteTemplates.filter(
            (candidate) => readString(candidate, "name") === definition.name,
          );
          const remote =
            namedTemplates.find(
              (candidate) =>
                (readString(candidate, ["language", "locale"]) ?? "") ===
                definition.locale,
            ) ?? namedTemplates[0];
          return remote === undefined
            ? missingTemplate(definition.name, definition.kind, syncedAt)
            : toTemplateSnapshot(remote, definition, syncedAt);
        }),
      };
    },

    async getNumberHealth(input) {
      return readNumberHealth(fetchImpl, options.apiKey, input.phoneNumberId);
    },

    async getBilling(input): Promise<WhatsAppBillingProviderResult> {
      const payload = await requestJson(
        fetchImpl,
        options.apiKey,
        `/whatsapp/phone_numbers/${encodeURIComponent(input.phoneNumberId)}/billing?waba_id=${encodeURIComponent(input.businessAccountId)}`,
        { method: "GET" },
      );
      const data = unwrapData(payload);
      const creditCents = readUsdCents(data, [
        "credit_balance_usd",
        "credit_balance",
        "remaining_credit_usd",
      ]);
      const consumedCents = readUsdCents(data, [
        "attributed_consumption_usd",
        "attributed_consumed_usd",
      ]);
      const metaChargesCents = readOptionalUsdCents(data, [
        "meta_charges_usd",
        "meta_cost_usd",
      ]);
      const platformChargesCents = readOptionalUsdCents(data, [
        "platform_charges_usd",
        "kapso_platform_charges_usd",
        "kapso_cost_usd",
      ]);
      const alertThresholdCents = readOptionalUsdCents(data, [
        "alert_threshold_usd",
        "alert_threshold",
      ]);
      const mode = readBillingMode(data);
      const chargesSeparated = readBoolean(data, [
        "charges_separated",
        "separate_charges",
      ]);
      const hasBalanceFields =
        hasAny(data, [
          "credit_balance_usd",
          "credit_balance",
          "remaining_credit_usd",
        ]) &&
        hasAny(data, ["attributed_consumption_usd", "attributed_consumed_usd"]);

      return {
        alertThresholdCents,
        chargesSeparated,
        consumedCents,
        creditCents,
        metaChargesCents,
        mode,
        platformChargesCents,
        status:
          hasBalanceFields && alertThresholdCents !== null && mode !== "unknown"
            ? "ready"
            : "pending",
      };
    },

    async runE2ETest(input) {
      const payload = await requestJson(
        fetchImpl,
        options.apiKey,
        `/whatsapp/webhooks/${encodeURIComponent(input.projectWebhookId)}/test`,
        {
          body: "{}",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const success = readBoolean(unwrapData(payload), ["success"]);
      if (!success) {
        throw new KapsoReadinessProviderError(
          422,
          "Kapso no confirmó la prueba del webhook de proyecto",
        );
      }
      const testedAt = new Date();
      return {
        evidence: `Kapso webhook test success=true; phone_number_id=${input.phoneNumberId}; tested_at=${testedAt.toISOString()}`,
        evidenceScope: "webhook-preflight",
        testedAt,
      };
    },
  };
}

async function readNumberHealth(
  fetchImpl: typeof fetch,
  apiKey: string | undefined,
  phoneNumberId: string,
) {
  const payload = await requestJson(
    fetchImpl,
    apiKey,
    `/whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}/health`,
    { method: "GET" },
  );
  const data = unwrapData(payload);
  const checkedAt =
    toDate(readString(data, "timestamp")) ??
    (isRecord(payload) ? toDate(readString(payload, "timestamp")) : null) ??
    new Date();
  return {
    checkedAt,
    health: normalizeNumberHealth(readString(data, ["health", "status"])),
  };
}

async function listMessageTemplates(
  fetchImpl: typeof fetch,
  apiKey: string | undefined,
  businessAccountId: string,
) {
  const templates: Record<string, unknown>[] = [];
  let after: string | undefined;

  while (true) {
    const query =
      after === undefined ? "" : `?after=${encodeURIComponent(after)}`;
    const payload = await requestJson(
      fetchImpl,
      apiKey,
      `${KAPSO_META_API_URL}/${encodeURIComponent(businessAccountId)}/message_templates${query}`,
      { baseUrl: "", method: "GET" },
    );
    templates.push(...readArray(payload, "data"));

    const nextAfter = readPagingAfter(payload);
    if (nextAfter === null || nextAfter === after) break;
    after = nextAfter;
  }

  return templates;
}

function missingTemplate(
  name: string,
  kind: WhatsAppTemplateSnapshot["kind"],
  syncedAt: Date,
): WhatsAppTemplateSnapshot {
  return {
    category: null,
    kind,
    locale: "",
    name,
    providerTemplateId: null,
    rejectionReason: null,
    status: "PENDING",
    syncedAt,
    variables: [],
  };
}

function toTemplateSnapshot(
  remote: Record<string, unknown>,
  definition: (typeof whatsappCriticalTemplateCatalog)[number],
  syncedAt: Date,
): WhatsAppTemplateSnapshot {
  return {
    category: normalizeTemplateCategory(readString(remote, "category")),
    kind: definition.kind,
    locale:
      readString(remote, "language") ?? readString(remote, "locale") ?? "",
    name: readString(remote, "name") ?? definition.name,
    providerTemplateId: readString(remote, "id"),
    rejectionReason:
      readString(remote, "rejected_reason") ??
      readString(remote, "rejection_reason") ??
      readString(remote, "reason"),
    status: normalizeTemplateStatus(readString(remote, "status")),
    syncedAt,
    variables: extractVariables(remote),
  };
}

function normalizeTemplateStatus(value: string | null) {
  switch (value?.toUpperCase()) {
    case "APPROVED":
      return "APPROVED" as const;
    case "REJECTED":
      return "REJECTED" as const;
    case "DISABLED":
      return "DISABLED" as const;
    case "PENDING":
    case "SUBMITTED":
    default:
      // Unrecognised values must never become an approval by accident.
      return "PENDING" as const;
  }
}

function normalizeTemplateCategory(
  value: string | null,
): WhatsAppTemplateCategory | null {
  switch (value?.toUpperCase()) {
    case "AUTHENTICATION":
      return "AUTHENTICATION";
    case "MARKETING":
      return "MARKETING";
    case "UTILITY":
      return "UTILITY";
    default:
      return null;
  }
}

function normalizeNumberHealth(value: string | null): WhatsAppNumberHealth {
  switch (value?.toLowerCase()) {
    case "healthy":
      return "healthy";
    case "degraded":
      return "degraded";
    case "unhealthy":
      return "unhealthy";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}

function extractVariables(remote: Record<string, unknown>) {
  const components = Array.isArray(remote.components) ? remote.components : [];
  const texts = components.flatMap((component) => {
    if (!isRecord(component)) return [];
    const text = component.text;
    return typeof text === "string" ? [text] : [];
  });
  const variables = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/{{\s*([^{}]+?)\s*}}/g)) {
      const variable = match[1]?.trim();
      if (variable !== undefined && variable !== "") variables.add(variable);
    }
  }
  return [...variables];
}

function readBillingMode(data: Record<string, unknown>) {
  const value = readString(data, ["meta_billing_mode", "billing_mode"])
    ?.trim()
    .toLowerCase();
  if (value === "partner_managed") return "partner_managed" as const;
  if (value === "customer_managed") return "customer_managed" as const;
  return "unknown" as const;
}

function readUsdCents(data: Record<string, unknown>, keys: string[]) {
  return readOptionalUsdCents(data, keys) ?? 0;
}

function readOptionalUsdCents(
  data: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.round(value * 100);
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.round(parsed * 100);
    }
  }
  return null;
}

function readBoolean(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof data[key] === "boolean") return data[key];
  }
  return false;
}

function hasAny(data: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => data[key] !== undefined && data[key] !== null);
}

function readArray(payload: unknown, key: string): Record<string, unknown>[] {
  const data = unwrapData(payload);
  const value = data[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readPagingAfter(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  for (const container of [unwrapData(payload), payload]) {
    const paging = isRecord(container.paging) ? container.paging : null;
    const cursors =
      paging !== null && isRecord(paging.cursors) ? paging.cursors : null;
    const after = cursors === null ? null : readString(cursors, "after");
    if (after !== null && after.trim() !== "") return after;
  }
  return null;
}

function readString(
  data: Record<string, unknown>,
  keys: string | string[],
): string | null {
  for (const key of typeof keys === "string" ? [keys] : keys) {
    if (typeof data[key] === "string") return data[key];
  }
  return null;
}

function toDate(value: string | null) {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function unwrapData(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) return {};
  const data = payload.data;
  return isRecord(data) ? data : payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return jsonObjectSchema.safeParse(value).success;
}

async function requestJson(
  fetchImpl: typeof fetch,
  apiKey: string | undefined,
  path: string,
  init: RequestInit & { baseUrl?: string },
) {
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new KapsoReadinessProviderError(
      0,
      "Kapso no está disponible para verificar readiness",
    );
  }
  const { baseUrl = KAPSO_PLATFORM_API_URL, ...requestInit } = init;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    KAPSO_REQUEST_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      ...requestInit,
      headers: {
        ...(requestInit.headers ?? {}),
        "X-API-Key": apiKey,
      },
      signal: controller.signal,
    });
  } catch {
    throw new KapsoReadinessProviderError(
      0,
      "Kapso no está disponible para verificar readiness",
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new KapsoReadinessProviderError(
      response.status,
      "Kapso rechazó la verificación de readiness",
    );
  }
  if (response.status === 204) return {};
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new KapsoReadinessProviderError(
      response.status,
      "Kapso devolvió una respuesta inválida para readiness",
    );
  }
}
