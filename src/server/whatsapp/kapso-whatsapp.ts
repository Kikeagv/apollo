import "server-only";

import type { TransactionalWhatsAppRoute } from "~/domain/whatsapp-delivery";
import { env } from "~/env";
import type { AppointmentReminderSender } from "~/server/application/appointment-reminders";
import type { ManualAppointmentTransactionalMessage } from "~/server/application/manual-appointments";
import type { WhatsAppInboundReplySender } from "~/server/application/whatsapp-inbound";
import { parseWhatsAppSmokeReplyIdempotencyKey } from "~/domain/whatsapp-smoke";
import type {
  WhatsAppBillingCapacityReservationResult,
  WhatsAppBillingCapacityStore,
} from "~/server/application/whatsapp-billing-capacity";
import {
  WhatsAppCircuitBreakerOpenError,
  WhatsAppConnectionRequiredError,
  type WhatsAppProvider,
  type WhatsAppSendResult,
} from "~/server/application/whatsapp-provider";
import { drizzleWhatsAppInboundStore } from "~/server/db/whatsapp-inbound-store";
import {
  requireWhatsAppConnectionReady,
  requireWhatsAppSmokeReplyConnectionReady,
  requireWhatsAppSmokeTemplateConsent,
  requireWhatsAppSmokeTemplateConnectionReady,
} from "~/server/db/whatsapp-connection-store";
import { reserveWhatsAppSendSlot } from "~/server/db/whatsapp-rate-limit-store";

export {
  WhatsAppCircuitBreakerOpenError,
  WhatsAppConnectionRequiredError,
} from "~/server/application/whatsapp-provider";

const KAPSO_META_API_URL = "https://api.kapso.ai/meta/whatsapp/v24.0";
const KAPSO_REQUEST_TIMEOUT_MS = 10_000;

export class KapsoWhatsAppProviderUnavailableError extends Error {
  constructor() {
    super("Kapso no está disponible para enviar WhatsApp");
    this.name = "KapsoWhatsAppProviderUnavailableError";
  }
}

export class KapsoWhatsAppProviderError extends Error {
  readonly ambiguous: boolean;
  readonly nextAttemptAt: Date | null;
  readonly rateLimit: { limit: number | null; remaining: number | null };
  readonly retryable: boolean;
  readonly status: number;

  constructor(input: {
    ambiguous: boolean;
    message: string;
    nextAttemptAt?: Date | null;
    rateLimit?: { limit: number | null; remaining: number | null };
    retryable: boolean;
    status: number;
  }) {
    super(input.message);
    this.name = "KapsoWhatsAppProviderError";
    this.ambiguous = input.ambiguous;
    this.nextAttemptAt = input.nextAttemptAt ?? null;
    this.rateLimit = input.rateLimit ?? { limit: null, remaining: null };
    this.retryable = input.retryable;
    this.status = input.status;
  }
}

type KapsoWhatsAppOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  reserveCapacity?: WhatsAppBillingCapacityStore;
  requireConnection?: typeof requireWhatsAppConnectionReady;
  requireSmokeReplyConnection?: typeof requireWhatsAppSmokeReplyConnectionReady;
  requireSmokeTemplateConsent?: typeof requireWhatsAppSmokeTemplateConsent;
  requireSmokeConnection?: typeof requireWhatsAppSmokeTemplateConnectionReady;
  reserveSendSlot?: typeof reserveWhatsAppSendSlot;
};

/**
 * Adaptador de salida Kapso. La conexión lista se resuelve por Clínica en
 * cada llamada; el proveedor nunca recibe un número global ni una credencial
 * persistida en Praxia.
 */
export type KapsoSmokeTemplateRequest = {
  clinicId: string;
  contactId: string;
  consentEvidence: {
    acceptedAt: Date;
    privacyVersion: string;
    reference: string;
    termsVersion: string;
    textReference: string;
  };
  idempotencyKey: string;
  recipientPhoneE164: string;
  route: Extract<TransactionalWhatsAppRoute, { kind: "template" }>;
};

export type KapsoWhatsAppSenders = Omit<WhatsAppProvider, "provider"> & {
  sendSmokeTemplate(
    input: KapsoSmokeTemplateRequest,
  ): Promise<WhatsAppSendResult>;
};

export function createKapsoWhatsAppSenders(
  options: KapsoWhatsAppOptions = {},
): KapsoWhatsAppSenders {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey ?? env.KAPSO_API_KEY;
  const now = options.now ?? (() => new Date());
  const requireConnection =
    options.requireConnection ?? requireWhatsAppConnectionReady;
  const requireSmokeConnection =
    options.requireSmokeConnection ??
    requireWhatsAppSmokeTemplateConnectionReady;
  const requireSmokeReplyConnection =
    options.requireSmokeReplyConnection ??
    requireWhatsAppSmokeReplyConnectionReady;
  const requireSmokeTemplateConsent =
    options.requireSmokeTemplateConsent ?? requireWhatsAppSmokeTemplateConsent;
  const reserveSendSlot = options.reserveSendSlot ?? reserveWhatsAppSendSlot;
  const reserveCapacity = options.reserveCapacity;

  return {
    appointmentMessageSender: {
      send: (message) =>
        sendAppointmentMessage({
          apiKey,
          fetchImpl,
          message,
          now,
          requireConnection,
          reserveCapacity,
          reserveSendSlot,
        }),
    },
    appointmentReminderSender: {
      send: (input) =>
        sendReminder({
          apiKey,
          fetchImpl,
          input,
          now,
          requireConnection,
          reserveCapacity,
          reserveSendSlot,
        }),
    },
    sendConversationReply: (input) => {
      const isSmokeReply =
        parseWhatsAppSmokeReplyIdempotencyKey(input.idempotencyKey) !== null;
      const requireReplyConnection = isSmokeReply
        ? ({ clinicId, provider }: Parameters<typeof requireConnection>[0]) =>
            requireSmokeReplyConnection({
              clinicId,
              idempotencyKey: input.idempotencyKey,
              provider,
              recipientPhoneE164: input.recipientPhoneE164,
            })
        : requireConnection;
      return sendKapsoMessage({
        apiKey,
        allowOpenCircuitForSmoke: isSmokeReply,
        clinicId: input.clinicId,
        fetchImpl,
        idempotencyKey: input.idempotencyKey,
        now,
        recipientBusinessScopedUserId:
          input.recipientBusinessScopedUserId ?? null,
        recipientPhoneE164: input.recipientPhoneE164,
        requireConnection: requireReplyConnection,
        reserveCapacity,
        reserveSendSlot,
        route:
          input.buttonLabel === undefined
            ? { kind: "text", text: input.text }
            : {
                buttonLabel: input.buttonLabel,
                kind: "interactive",
                text: input.text,
              },
      });
    },
    sendConversationEscalationNotification: (input) =>
      sendKapsoMessage({
        apiKey,
        clinicId: input.clinicId,
        fetchImpl,
        idempotencyKey: `escalation:${input.escalationId}`,
        now,
        recipientBusinessScopedUserId: null,
        recipientPhoneE164: input.recipientPhoneE164,
        requireConnection,
        reserveCapacity,
        reserveSendSlot,
        route: {
          kind: "text",
          text: "La Clínica recibió tu solicitud y una persona te contactará pronto.",
        },
      }),
    sendSmokeTemplate: (input: KapsoSmokeTemplateRequest) =>
      sendKapsoMessage({
        apiKey,
        beforeSend: () =>
          requireSmokeTemplateConsent({
            clinicId: input.clinicId,
            contactId: input.contactId,
            consentEvidence: input.consentEvidence,
            now: now(),
            phoneE164: input.recipientPhoneE164,
          }),
        clinicId: input.clinicId,
        fetchImpl,
        idempotencyKey: input.idempotencyKey,
        now,
        recipientPhoneE164: input.recipientPhoneE164,
        requireConnection: requireSmokeConnection,
        reserveCapacity,
        reserveSendSlot,
        route: input.route,
      }),
  };
}

async function sendAppointmentMessage(input: {
  apiKey: string | undefined;
  fetchImpl: typeof fetch;
  message: ManualAppointmentTransactionalMessage;
  now: () => Date;
  reserveCapacity?: WhatsAppBillingCapacityStore;
  requireConnection: typeof requireWhatsAppConnectionReady;
  reserveSendSlot: typeof reserveWhatsAppSendSlot;
}) {
  const route =
    input.message.route ??
    ({
      kind: "text",
      text:
        input.message.type === "manual-confirmation" ||
        input.message.type === "confirmation"
          ? "Tu cita ha sido confirmada por la Clínica."
          : input.message.type === "manual-cancellation" ||
              input.message.type === "cancellation"
            ? "La Clínica canceló tu cita."
            : "Tu cita fue reprogramada.",
    } satisfies TransactionalWhatsAppRoute);
  return sendKapsoMessage({
    apiKey: input.apiKey,
    clinicId: input.message.clinicId,
    fetchImpl: input.fetchImpl,
    idempotencyKey:
      input.message.idempotencyKey ??
      `${input.message.appointmentId}:${input.message.type}:${input.message.recipient.id}`,
    now: input.now,
    recipientBusinessScopedUserId:
      input.message.recipientBusinessScopedUserId ?? null,
    recipientPhoneE164: input.message.recipient.phoneE164,
    requireConnection: input.requireConnection,
    reserveCapacity: input.reserveCapacity,
    reserveSendSlot: input.reserveSendSlot,
    route,
  });
}

async function sendReminder(input: {
  apiKey: string | undefined;
  fetchImpl: typeof fetch;
  input: Parameters<AppointmentReminderSender["send"]>[0];
  now: () => Date;
  reserveCapacity?: WhatsAppBillingCapacityStore;
  requireConnection: typeof requireWhatsAppConnectionReady;
  reserveSendSlot: typeof reserveWhatsAppSendSlot;
}) {
  const route =
    input.input.route ??
    ({
      kind: "text",
      text: "Te recordamos tu cita en la Clínica.",
    } satisfies TransactionalWhatsAppRoute);
  return sendKapsoMessage({
    apiKey: input.apiKey,
    clinicId: input.input.clinicId,
    fetchImpl: input.fetchImpl,
    idempotencyKey: input.input.idempotencyKey,
    now: input.now,
    recipientBusinessScopedUserId:
      input.input.recipientBusinessScopedUserId ?? null,
    recipientPhoneE164: input.input.recipient.phoneE164,
    requireConnection: input.requireConnection,
    reserveCapacity: input.reserveCapacity,
    reserveSendSlot: input.reserveSendSlot,
    route,
  });
}

async function sendKapsoMessage(input: {
  allowOpenCircuitForSmoke?: boolean;
  apiKey: string | undefined;
  beforeSend?: () => Promise<void>;
  clinicId: string;
  fetchImpl: typeof fetch;
  idempotencyKey: string;
  now: () => Date;
  recipientBusinessScopedUserId?: string | null;
  recipientPhoneE164: string | null;
  reserveCapacity?: WhatsAppBillingCapacityStore;
  requireConnection: typeof requireWhatsAppConnectionReady;
  reserveSendSlot: typeof reserveWhatsAppSendSlot;
  route: TransactionalWhatsAppRoute;
}): Promise<WhatsAppSendResult> {
  if (input.apiKey === undefined || input.apiKey.trim() === "") {
    throw new KapsoWhatsAppProviderUnavailableError();
  }
  const connection = await input.requireConnection({
    clinicId: input.clinicId,
    provider: "kapso",
  });
  if (connection.phoneNumberId === null) {
    throw new WhatsAppConnectionRequiredError();
  }
  const body = requestBody({
    idempotencyKey: input.idempotencyKey,
    recipientBusinessScopedUserId: input.recipientBusinessScopedUserId,
    recipientPhoneE164: input.recipientPhoneE164,
    route: input.route,
  });
  let capacityReserved = false;
  if (input.reserveCapacity !== undefined) {
    const reservation = await input.reserveCapacity.reserve({
      allowOpenCircuitForSmoke: input.allowOpenCircuitForSmoke,
      clinicId: input.clinicId,
      now: input.now(),
      recipientPhoneE164: input.recipientPhoneE164,
      reservationKey: input.idempotencyKey,
    });
    if (!reservation.reserved) {
      if (reservation.reason === "circuit-open") {
        throw new WhatsAppCircuitBreakerOpenError(input.clinicId);
      }
      throw new KapsoWhatsAppProviderError({
        ambiguous: false,
        message: capacityErrorMessage(reservation.reason),
        retryable: true,
        status: 429,
      });
    }
    capacityReserved = true;
  }
  let waitMs: number;
  try {
    waitMs = await input.reserveSendSlot({
      clinicId: input.clinicId,
      now: input.now(),
      phoneNumberId: connection.phoneNumberId,
    });
    if (waitMs > 0) await waitForRateLimit(waitMs);
    const currentConnection = await input.requireConnection({
      clinicId: input.clinicId,
      provider: "kapso",
    });
    if (currentConnection.phoneNumberId !== connection.phoneNumberId) {
      throw new WhatsAppConnectionRequiredError();
    }
    await input.beforeSend?.();
  } catch (error) {
    await settleCapacity({
      capacityReserved,
      clinicId: input.clinicId,
      now: input.now(),
      outcome: "failed",
      reservationKey: input.idempotencyKey,
      reserveCapacity: input.reserveCapacity,
    });
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    KAPSO_REQUEST_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await input.fetchImpl(
      `${KAPSO_META_API_URL}/${encodeURIComponent(connection.phoneNumberId)}/messages`,
      {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": input.apiKey,
          "X-Idempotency-Key": input.idempotencyKey,
        },
        method: "POST",
        signal: controller.signal,
      },
    );
  } catch (error) {
    await settleCapacity({
      capacityReserved,
      clinicId: input.clinicId,
      now: input.now(),
      outcome: "unknown",
      reservationKey: input.idempotencyKey,
      reserveCapacity: input.reserveCapacity,
    });
    throw new KapsoWhatsAppProviderError({
      ambiguous: true,
      message:
        error instanceof Error
          ? `No se pudo confirmar el envío de Kapso: ${error.message}`
          : "No se pudo confirmar el envío de Kapso",
      retryable: false,
      status: 0,
    });
  } finally {
    clearTimeout(timeout);
  }

  const rateLimit = readRateLimit(response.headers);
  let text: string;
  try {
    text = await readResponseText(response);
  } catch (error) {
    await settleCapacity({
      capacityReserved,
      clinicId: input.clinicId,
      now: input.now(),
      outcome: "unknown",
      reservationKey: input.idempotencyKey,
      reserveCapacity: input.reserveCapacity,
    });
    throw error;
  }
  const payload = parseJson(text);
  if (!response.ok) {
    const retryable =
      response.status === 409 ||
      response.status === 429 ||
      response.status === 408 ||
      response.status >= 500;
    const providerError = new KapsoWhatsAppProviderError({
      ambiguous: false,
      message: readProviderError(payload),
      nextAttemptAt:
        response.status === 429
          ? retryAtFromResponse(input.now(), response.headers)
          : null,
      rateLimit,
      retryable,
      status: response.status,
    });
    await settleCapacity({
      capacityReserved,
      clinicId: input.clinicId,
      now: input.now(),
      outcome: "failed",
      reservationKey: input.idempotencyKey,
      reserveCapacity: input.reserveCapacity,
    });
    throw providerError;
  }

  const providerMessageId = readMessageId(payload);
  if (providerMessageId === null) {
    const providerError = new KapsoWhatsAppProviderError({
      ambiguous: true,
      message: "Kapso aceptó la solicitud sin devolver el ID del mensaje",
      rateLimit,
      retryable: false,
      status: response.status,
    });
    await settleCapacity({
      capacityReserved,
      clinicId: input.clinicId,
      now: input.now(),
      outcome: "unknown",
      reservationKey: input.idempotencyKey,
      reserveCapacity: input.reserveCapacity,
    });
    throw providerError;
  }
  await settleCapacity({
    capacityReserved,
    clinicId: input.clinicId,
    now: input.now(),
    outcome: "accepted",
    reservationKey: input.idempotencyKey,
    reserveCapacity: input.reserveCapacity,
  });
  return { providerMessageId, status: "accepted" };
}

async function settleCapacity(input: {
  capacityReserved: boolean;
  clinicId: string;
  now: Date;
  outcome: "accepted" | "delivered" | "failed" | "unknown";
  reservationKey: string;
  reserveCapacity?: WhatsAppBillingCapacityStore;
}) {
  if (!input.capacityReserved || input.reserveCapacity === undefined) return;
  try {
    await input.reserveCapacity.settle({
      clinicId: input.clinicId,
      now: input.now,
      outcome: input.outcome,
      reservationKey: input.reservationKey,
    });
  } catch {
    // La Reserva sigue `reserved`; el outbox debe volver a intentar con la
    // misma clave hasta que Kapso y la liquidación converjan.
    throw new KapsoWhatsAppProviderError({
      ambiguous: false,
      message: "No se pudo liquidar la capacidad reservada de Kapso",
      retryable: true,
      status: 503,
    });
  }
}

function capacityErrorMessage(
  reason: Extract<
    WhatsAppBillingCapacityReservationResult,
    { reserved: false }
  >["reason"],
) {
  switch (reason) {
    case "circuit-open":
      return "La Conexión de WhatsApp está pausada por el circuit breaker";
    case "credit-exhausted":
      return "La reserva de crédito de Kapso está agotada";
    case "quota-exhausted":
      return "La cuota mensual de mensajes de Kapso está agotada";
    case "billing-not-ready":
      return "El billing de Kapso todavía no está verificado";
  }
}

function requestBody(input: {
  idempotencyKey: string;
  recipientBusinessScopedUserId?: string | null;
  recipientPhoneE164: string | null;
  route: TransactionalWhatsAppRoute;
}) {
  const recipient =
    input.recipientBusinessScopedUserId === null ||
    input.recipientBusinessScopedUserId === undefined
      ? { to: normalizePhoneForKapso(input.recipientPhoneE164) }
      : { recipient: input.recipientBusinessScopedUserId };
  const content =
    input.route.kind === "text"
      ? { text: { body: input.route.text }, type: "text" as const }
      : input.route.kind === "interactive"
        ? {
            interactive: {
              action: {
                buttons: [
                  {
                    reply: {
                      id: "continue",
                      title: input.route.buttonLabel,
                    },
                    type: "reply" as const,
                  },
                ],
              },
              body: { text: input.route.text },
              type: "button" as const,
            },
            type: "interactive" as const,
          }
        : {
            template: {
              components: [
                {
                  parameters: input.route.parameters.map((text) => ({
                    text,
                    type: "text" as const,
                  })),
                  type: "body" as const,
                },
              ],
              language: { code: input.route.locale },
              name: input.route.name,
            },
            type: "template" as const,
          };
  return {
    biz_opaque_callback_data: input.idempotencyKey,
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...recipient,
    ...content,
  };
}

function normalizePhoneForKapso(phone: string | null) {
  if (phone === null) {
    throw new KapsoWhatsAppProviderError({
      ambiguous: false,
      message: "La Entrega transaccional no tiene un destinatario de WhatsApp",
      retryable: false,
      status: 422,
    });
  }
  return phone.replace(/^\+/, "");
}

function readMessageId(payload: unknown): string | null {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const messages = Array.isArray(root.messages)
    ? root.messages
    : Array.isArray(data.messages)
      ? data.messages
      : [];
  const first = asRecord(messages[0]);
  return firstString(first.id);
}

function readProviderError(payload: unknown) {
  const root = asRecord(payload);
  const error = asRecord(root.error);
  return (
    firstString(error.message, root.error_message, root.message) ??
    "Kapso rechazó el envío de WhatsApp"
  );
}

async function readResponseText(response: Response) {
  try {
    return await response.text();
  } catch {
    throw new KapsoWhatsAppProviderError({
      ambiguous: true,
      message: "No se pudo leer la respuesta de Kapso",
      retryable: false,
      status: 0,
    });
  }
}

function parseJson(text: string): unknown {
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function retryAtFromResponse(now: Date, headers: Headers) {
  const retryAfter = headers.get("Retry-After");
  if (retryAfter === null) return null;
  const seconds = Number(retryAfter.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return new Date(now.valueOf() + seconds * 1_000);
  }
  const date = new Date(retryAfter);
  return Number.isNaN(date.valueOf()) || date <= now ? null : date;
}

function readRateLimit(headers: Headers) {
  return {
    limit: readIntegerHeader(headers.get("X-RateLimit-Limit")),
    remaining: readIntegerHeader(headers.get("X-RateLimit-Remaining")),
  };
}

async function waitForRateLimit(milliseconds: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function readIntegerHeader(value: string | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized !== "") return normalized;
  }
  return null;
}

/** Encola la respuesta del worker inbound; el worker outbound la drenará. */
export function createKapsoInboundReplySender(): WhatsAppInboundReplySender {
  return {
    async send(input) {
      // Enqueue first even when Kapso is degraded. The outbound worker owns
      // readiness/circuit checks and can retry the notification after manual
      // reactivation without making the inbound takeover retry.
      await drizzleWhatsAppInboundStore.enqueueReply(input);
    },
  };
}

export type KapsoInboundReplyProvider = {
  send(
    input: Parameters<WhatsAppInboundReplySender["send"]>[0],
  ): Promise<WhatsAppSendResult>;
};

/** Cruza el outbox de respuestas con el mismo transporte de Kapso. */
export function createKapsoInboundReplyProvider(
  options: KapsoWhatsAppOptions = {},
): KapsoInboundReplyProvider {
  const senders = createKapsoWhatsAppSenders(options);
  return {
    send(input) {
      return senders.sendConversationReply({
        buttonLabel: input.buttonLabel,
        clinicId: input.clinicId,
        idempotencyKey: input.idempotencyKey,
        recipientBusinessScopedUserId: input.recipientBusinessScopedUserId,
        recipientPhoneE164: input.recipientPhoneE164,
        text: input.text,
      }) as Promise<WhatsAppSendResult>;
    },
  };
}
