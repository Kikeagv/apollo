import { z } from "zod";

import {
  isWhatsAppNumberMessagingAvailable,
  whatsappCriticalTemplateCatalog,
  type WhatsAppNumberHealth,
  type WhatsAppTemplateCategory,
  type WhatsAppTemplateDefinition,
  type WhatsAppTemplateProvisioningStatus,
  type WhatsAppTemplateSnapshot,
} from "~/domain/whatsapp-readiness";
import { sanitizeWhatsAppOperationalText } from "~/domain/whatsapp-circuit-breaker";
import { kapsoProjectWebhookEvents } from "~/domain/whatsapp-kapso-provisioning";
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
    async getPhoneNumber(phoneNumberId) {
      try {
        const payload = await requestJson(
          fetchImpl,
          options.apiKey,
          `/whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}`,
          { method: "GET" },
        );
        const data = unwrapData(payload);
        const remotePhoneNumberId = readString(data, "phone_number_id");
        const customerId = readString(data, "customer_id");
        if (
          remotePhoneNumberId === null ||
          remotePhoneNumberId.trim() === "" ||
          customerId === null ||
          customerId.trim() === ""
        ) {
          throw new KapsoReadinessProviderError(
            0,
            "Kapso devolvió una asociación incompleta del número",
          );
        }
        const businessAccountId = readString(data, "business_account_id");
        return {
          businessAccountId:
            businessAccountId === null || businessAccountId.trim() === ""
              ? null
              : businessAccountId,
          customerId,
          phoneNumberId: remotePhoneNumberId,
        };
      } catch (error) {
        if (
          error instanceof KapsoReadinessProviderError &&
          error.status === 404
        ) {
          return undefined;
        }
        throw error;
      }
    },
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
      if (!isWhatsAppNumberMessagingAvailable(numberHealth)) {
        return {
          numberEnvironment,
          numberHealth,
          numberHealthCheckedAt: health.checkedAt,
          syncedAt,
          templates: [],
        };
      }

      let remoteTemplates = await listMessageTemplates(
        fetchImpl,
        options.apiKey,
        input.businessAccountId,
      );

      const templates: WhatsAppTemplateSnapshot[] = [];
      for (const definition of whatsappCriticalTemplateCatalog) {
        const remote = findRemoteTemplate(remoteTemplates, definition);
        if (remote !== undefined) {
          templates.push(toTemplateSnapshot(remote, definition, syncedAt));
          continue;
        }

        try {
          const created = await createMessageTemplateAndRecover({
            apiKey: options.apiKey,
            businessAccountId: input.businessAccountId,
            definition,
            fetchImpl,
            listTemplates: () =>
              listMessageTemplates(
                fetchImpl,
                options.apiKey,
                input.businessAccountId,
              ),
            existingTemplates: remoteTemplates,
          });
          remoteTemplates = created.templates;
          templates.push(
            created.recovered
              ? toTemplateSnapshot(created.template, definition, syncedAt)
              : toSubmittedTemplateSnapshot(
                  created.template,
                  definition,
                  syncedAt,
                ),
          );
        } catch (error) {
          if (!isTemplateSubmissionRejection(error)) throw error;
          templates.push(rejectedTemplate(definition, syncedAt, error));
        }
      }

      return {
        numberHealth,
        numberEnvironment,
        numberHealthCheckedAt: health.checkedAt,
        syncedAt,
        templates,
      };
    },

    async getNumberHealth(input) {
      return readNumberHealth(fetchImpl, options.apiKey, input.phoneNumberId);
    },

    async getBilling(input): Promise<WhatsAppBillingProviderResult> {
      const payload = await requestJson(
        fetchImpl,
        options.apiKey,
        `/whatsapp/accounts/${encodeURIComponent(input.businessAccountId)}/funding`,
        { method: "GET" },
      );
      const data = unwrapData(payload);
      if (readString(data, "waba_id") !== input.businessAccountId) {
        throw new KapsoReadinessProviderError(
          0,
          "Kapso devolvió funding para otro WhatsApp Business Account",
        );
      }
      const kapsoFundingStatus = normalizeKapsoFundingStatus(
        readString(data, "status"),
      );
      if (kapsoFundingStatus === null) {
        throw new KapsoReadinessProviderError(
          0,
          "Kapso devolvió un estado de funding no reconocido",
        );
      }
      const paidMessages = isRecord(data.paid_messages)
        ? data.paid_messages
        : null;
      const kapsoPaidMessagesPaused =
        typeof paidMessages?.paused === "boolean" ? paidMessages.paused : null;
      if (kapsoPaidMessagesPaused === null) {
        throw new KapsoReadinessProviderError(
          0,
          "Kapso no confirmó si los mensajes pagados están pausados",
        );
      }

      return {
        alertThresholdCents: null,
        chargesSeparated: false,
        consumedCents: 0,
        creditBalanceKnown: false,
        creditCents: 0,
        kapsoFundingReason: readString(data, "reason"),
        kapsoFundingStatus,
        kapsoPaidMessagesPaused,
        mode:
          kapsoFundingStatus === "funded"
            ? "partner_managed"
            : kapsoFundingStatus === "not_funded" &&
                readString(data, "reason") === "existing_payment_method"
              ? "customer_managed"
              : "unknown",
        status: "ready",
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

    async runSyntheticSmoke(input) {
      const payload = await requestJson(
        fetchImpl,
        options.apiKey,
        `/whatsapp/webhooks/${encodeURIComponent(input.projectWebhookId)}/test`,
        {
          // El endpoint oficial solo acepta event_type. El resto del smoke
          // sintético se ejecuta dentro de Praxia con un Contacto sintético.
          body: JSON.stringify({ event_type: kapsoProjectWebhookEvents[0] }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const data = unwrapData(payload);
      if (!readBoolean(data, ["success"])) {
        throw new KapsoReadinessProviderError(
          422,
          "Kapso no confirmó el smoke sintético del webhook de proyecto",
        );
      }
      const testedAt = new Date();
      return {
        evidence: sanitizeWhatsAppOperationalText(
          `Kapso webhook test success=true; event_type=${kapsoProjectWebhookEvents[0]}; phone_number_id=${input.phoneNumberId}; synthetic_contact_id=${input.syntheticContactId}; tested_at=${testedAt.toISOString()}`,
        ),
        // El endpoint oficial confirma la prueba del webhook, no cada contrato
        // externo requerido por APO-92. Por eso no puede habilitar tráfico real.
        providerTransportVerified: false,
        realPatientsEnabled: false,
        steps: {
          "webhook-preflight": {
            evidence: `Kapso confirmó el test del webhook de proyecto; event_type=${kapsoProjectWebhookEvents[0]}`,
            observedAt: testedAt,
            passed: true,
            source: "provider",
            status: "passed",
          },
        },
        syntheticContact: input.syntheticContactId.startsWith("synthetic-"),
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
    health: normalizeNumberHealth(data),
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

async function createMessageTemplateAndRecover(input: {
  apiKey: string | undefined;
  businessAccountId: string;
  definition: WhatsAppTemplateDefinition;
  fetchImpl: typeof fetch;
  existingTemplates: Record<string, unknown>[];
  listTemplates: () => Promise<Record<string, unknown>[]>;
}) {
  try {
    const payload = await requestJson(
      input.fetchImpl,
      input.apiKey,
      `${KAPSO_META_API_URL}/${encodeURIComponent(input.businessAccountId)}/message_templates`,
      {
        baseUrl: "",
        body: JSON.stringify(templateCreatePayload(input.definition)),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    const template = parseCreatedTemplate(payload);
    return {
      template,
      templates: [...input.existingTemplates, template],
      recovered: false,
    };
  } catch (error) {
    if (
      !isAmbiguousTemplateCreateError(error) &&
      !isTemplateAlreadyExistsError(error)
    ) {
      throw error;
    }

    let recoveredTemplates: Record<string, unknown>[];
    try {
      recoveredTemplates = await input.listTemplates();
    } catch {
      throw retryableTemplateCreateError(error);
    }
    const recovered = findRemoteTemplate(recoveredTemplates, input.definition);
    if (recovered !== undefined) {
      return {
        template: recovered,
        templates: recoveredTemplates,
        recovered: true,
      };
    }
    throw retryableTemplateCreateError(error);
  }
}

function templateCreatePayload(definition: WhatsAppTemplateDefinition) {
  return {
    category: definition.category,
    components: [
      {
        example: {
          body_text: [
            definition.variables.map(
              (variable) => definition.examples[variable] ?? variable,
            ),
          ],
        },
        text: definition.content,
        type: "BODY",
      },
    ],
    language: definition.locale,
    name: definition.name,
    parameter_format: "POSITIONAL",
  };
}

function parseCreatedTemplate(payload: unknown): Record<string, unknown> {
  const data = unwrapData(payload);
  if (readString(data, "id") === null) {
    throw new KapsoReadinessProviderError(
      0,
      "Kapso devolvió una respuesta ambigua al crear la plantilla",
    );
  }
  return data;
}

function isAmbiguousTemplateCreateError(error: unknown) {
  if (error instanceof KapsoReadinessProviderError) {
    return (
      error.status === 0 ||
      error.status === 408 ||
      error.status === 409 ||
      error.status >= 500
    );
  }
  return error instanceof z.ZodError;
}

function retryableTemplateCreateError(error: unknown) {
  if (error instanceof KapsoReadinessProviderError && error.status === 0) {
    return error;
  }
  return new KapsoReadinessProviderError(
    0,
    error instanceof Error
      ? `No se pudo confirmar la creación de la plantilla: ${error.message}`
      : "No se pudo confirmar la creación de la plantilla",
  );
}

function isTemplateSubmissionRejection(error: unknown) {
  return (
    error instanceof KapsoReadinessProviderError &&
    (error.status === 400 || error.status === 422)
  );
}

function isTemplateAlreadyExistsError(error: unknown) {
  return (
    error instanceof KapsoReadinessProviderError &&
    /\b(?:already exists|duplicate|ya existe|duplicad[oa])\b/i.test(
      error.message,
    )
  );
}

function findRemoteTemplate(
  remoteTemplates: Record<string, unknown>[],
  definition: WhatsAppTemplateDefinition,
) {
  return remoteTemplates.find(
    (candidate) =>
      readString(candidate, "name") === definition.name &&
      readString(candidate, ["language", "locale"]) === definition.locale,
  );
}

function missingTemplate(
  definition: WhatsAppTemplateDefinition,
  syncedAt: Date,
): WhatsAppTemplateSnapshot {
  return {
    category: definition.category,
    catalogVersion: definition.version,
    content: definition.content,
    examples: { ...definition.examples },
    kind: definition.kind,
    locale: definition.locale,
    name: definition.name,
    providerTemplateId: null,
    provisioningStatus: "missing",
    rejectionReason: null,
    status: "PENDING",
    syncedAt,
    variables: [...definition.variables],
  };
}

function toTemplateSnapshot(
  remote: Record<string, unknown>,
  definition: WhatsAppTemplateDefinition,
  syncedAt: Date,
  provisioningStatus?: WhatsAppTemplateProvisioningStatus,
): WhatsAppTemplateSnapshot {
  const status = normalizeTemplateStatus(readString(remote, "status"));
  const remoteVariables = canonicalTemplateVariables(
    extractVariables(remote),
    definition,
  );
  return {
    category: normalizeTemplateCategory(readString(remote, "category")),
    catalogVersion: definition.version,
    content: extractTemplateContent(remote),
    examples: { ...definition.examples },
    kind: definition.kind,
    locale:
      readString(remote, "language") ??
      readString(remote, "locale") ??
      definition.locale,
    name: readString(remote, "name") ?? definition.name,
    providerTemplateId: readString(remote, "id"),
    provisioningStatus:
      provisioningStatus ?? provisioningStatusForRemoteStatus(status),
    rejectionReason:
      readString(remote, "rejected_reason") ??
      readString(remote, "rejection_reason") ??
      readString(remote, "reason"),
    status,
    syncedAt,
    variables: remoteVariables,
  };
}

function toSubmittedTemplateSnapshot(
  remote: Record<string, unknown>,
  definition: WhatsAppTemplateDefinition,
  syncedAt: Date,
): WhatsAppTemplateSnapshot {
  const components =
    extractTemplateContent(remote) === ""
      ? [{ text: definition.content, type: "BODY" }]
      : remote.components;
  const status = normalizeTemplateStatus(readString(remote, "status"));
  const provisioningStatus =
    status === "PENDING"
      ? "submitted"
      : provisioningStatusForRemoteStatus(status);
  return toTemplateSnapshot(
    {
      ...remote,
      category: readString(remote, "category") ?? definition.category,
      components,
    },
    definition,
    syncedAt,
    provisioningStatus,
  );
}

function rejectedTemplate(
  definition: WhatsAppTemplateDefinition,
  syncedAt: Date,
  error: unknown,
): WhatsAppTemplateSnapshot {
  return {
    ...missingTemplate(definition, syncedAt),
    provisioningStatus: "rejected",
    rejectionReason:
      error instanceof Error ? error.message : "Meta rechazó la plantilla",
    status: "REJECTED",
  };
}

function provisioningStatusForRemoteStatus(
  status: WhatsAppTemplateSnapshot["status"],
): WhatsAppTemplateProvisioningStatus {
  switch (status) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
    case "DISABLED":
      return "rejected";
    case "PENDING":
    default:
      return "in_review";
  }
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

function normalizeNumberHealth(
  data: Record<string, unknown>,
): WhatsAppNumberHealth {
  const value = readString(data, ["health", "status"])?.toLowerCase();
  switch (value) {
    case "healthy":
      return "healthy";
    case "degraded":
      return hasLimitedButAvailableMessaging(data) ? "limited" : "degraded";
    case "unhealthy":
      return "unhealthy";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}

/** Accept Meta's limited mode only when all non-messaging checks still pass. */
function hasLimitedButAvailableMessaging(data: Record<string, unknown>) {
  if (
    data.retry_after !== undefined &&
    data.retry_after !== null &&
    data.retry_after !== ""
  ) {
    return false;
  }
  if (typeof data.error === "string" && data.error.trim() !== "") return false;

  const checks = isRecord(data.checks) ? data.checks : null;
  if (checks === null) return false;

  const messagingHealth = checks.messaging_health;
  if (
    !isRecord(messagingHealth) ||
    readString(messagingHealth, "overall_status")?.toUpperCase() !== "LIMITED"
  ) {
    return false;
  }
  const details = isRecord(messagingHealth.details)
    ? messagingHealth.details
    : null;
  if (
    details === null ||
    readString(details, "can_send_message")?.toUpperCase() !== "LIMITED"
  ) {
    return false;
  }

  const requiredChecks = [
    "phone_number_access",
    "phone_number_connection",
    "webhook_subscription",
    "webhook_verified",
  ];
  if (
    requiredChecks.some((name) => {
      const check = checks[name];
      return !isRecord(check) || check.passed !== true;
    })
  ) {
    return false;
  }
  if (
    Object.entries(checks).some(
      ([name, check]) =>
        name !== "messaging_health" &&
        (!isRecord(check) || check.passed !== true),
    )
  ) {
    return false;
  }

  const entities = Array.isArray(details.entities)
    ? details.entities.filter(isRecord)
    : [];
  return (
    entities.length > 0 &&
    entities.every(
      (entity) =>
        readString(entity, "can_send_message")?.toUpperCase() !== "BLOCKED",
    ) &&
    entities.some(
      (entity) =>
        readString(entity, "can_send_message")?.toUpperCase() === "LIMITED",
    )
  );
}

function extractTemplateContent(remote: Record<string, unknown>) {
  const components = readArray({ components: remote.components }, "components");
  const body = components.find(
    (component) => readString(component, "type")?.toUpperCase() === "BODY",
  );
  return body !== undefined && typeof body.text === "string" ? body.text : "";
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

function canonicalTemplateVariables(
  remoteVariables: string[],
  definition: WhatsAppTemplateDefinition,
) {
  if (!remoteVariables.every((variable) => /^\d+$/.test(variable))) {
    return remoteVariables;
  }
  return remoteVariables.map((variable) => {
    const position = Number(variable) - 1;
    return definition.variables[position] ?? variable;
  });
}

function normalizeKapsoFundingStatus(
  value: string | null,
): "funded" | "pending" | "unknown" | "not_funded" | "revoked" | null {
  switch (value?.toLowerCase()) {
    case "funded":
    case "pending":
    case "unknown":
    case "not_funded":
    case "revoked":
      return value.toLowerCase() as
        "funded" | "pending" | "unknown" | "not_funded" | "revoked";
    default:
      return null;
  }
}

function readBoolean(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof data[key] === "boolean") return data[key];
  }
  return false;
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
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // La causa útil puede no venir en respuestas de error parciales.
    }
    const data = isRecord(payload) ? unwrapData(payload) : {};
    const nestedError = isRecord(data.error) ? data.error : null;
    const errorTitle =
      nestedError === null ? null : readString(nestedError, "error_user_title");
    const errorUserMessage =
      nestedError === null
        ? null
        : readString(nestedError, ["error_user_msg", "error_description"]);
    const errorMessage =
      nestedError === null ? null : readString(nestedError, "message");
    const subcode =
      nestedError !== null &&
      (typeof nestedError.error_subcode === "number" ||
        typeof nestedError.error_subcode === "string")
        ? String(nestedError.error_subcode)
        : null;
    const nestedReason =
      errorTitle !== null && errorUserMessage !== null
        ? `${errorTitle}: ${errorUserMessage}`
        : (errorUserMessage ?? errorTitle ?? errorMessage);
    const reason =
      nestedReason ??
      readString(data, [
        "error",
        "error_message",
        "message",
        "reason",
        "rejected_reason",
        "rejection_reason",
      ]);
    throw new KapsoReadinessProviderError(
      response.status,
      reason === null
        ? "Kapso rechazó la verificación de readiness"
        : sanitizeWhatsAppOperationalText(
            subcode === null ? reason : `${reason} (Meta subcode ${subcode})`,
          ),
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
