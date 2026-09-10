import "server-only";

import type { TransactionalWhatsAppRoute } from "~/domain/whatsapp-delivery";
import { env } from "~/env";
import type { AppointmentReminderSender } from "~/server/application/appointment-reminders";
import type { ManualAppointmentTransactionalMessage } from "~/server/application/manual-appointments";
import type { WhatsAppInboundReplySender } from "~/server/application/whatsapp-inbound";
import {
  WhatsAppConnectionRequiredError,
  type WhatsAppProvider,
  type WhatsAppSendResult,
} from "~/server/application/whatsapp-provider";
import { drizzleWhatsAppInboundStore } from "~/server/db/whatsapp-inbound-store";
import { requireWhatsAppConnectionReady } from "~/server/db/whatsapp-connection-store";
import { reserveWhatsAppSendSlot } from "~/server/db/whatsapp-rate-limit-store";

export { WhatsAppConnectionRequiredError } from "~/server/application/whatsapp-provider";

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
  requireConnection?: typeof requireWhatsAppConnectionReady;
  reserveSendSlot?: typeof reserveWhatsAppSendSlot;
};

/**
 * Adaptador de salida Kapso. La conexión lista se resuelve por Clínica en
 * cada llamada; el proveedor nunca recibe un número global ni una credencial
 * persistida en Praxia.
 */
export type KapsoWhatsAppSenders = Omit<WhatsAppProvider, "provider">;

export function createKapsoWhatsAppSenders(
  options: KapsoWhatsAppOptions = {},
): KapsoWhatsAppSenders {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey ?? env.KAPSO_API_KEY;
  const now = options.now ?? (() => new Date());
  const requireConnection =
    options.requireConnection ?? requireWhatsAppConnectionReady;
  const reserveSendSlot = options.reserveSendSlot ?? reserveWhatsAppSendSlot;

  return {
    appointmentMessageSender: {
      send: (message) =>
        sendAppointmentMessage({
          apiKey,
          fetchImpl,
          message,
          now,
          requireConnection,
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
          reserveSendSlot,
        }),
    },
    sendConversationReply: (input) =>
      sendKapsoMessage({
        apiKey,
        clinicId: input.clinicId,
        fetchImpl,
        idempotencyKey: input.idempotencyKey,
        now,
        recipientBusinessScopedUserId:
          input.recipientBusinessScopedUserId ?? null,
        recipientPhoneE164: input.recipientPhoneE164,
        requireConnection,
        reserveSendSlot,
        route:
          input.buttonLabel === undefined
            ? { kind: "text", text: input.text }
            : {
                buttonLabel: input.buttonLabel,
                kind: "interactive",
                text: input.text,
              },
      }),
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
        reserveSendSlot,
        route: {
          kind: "text",
          text: "La Clínica recibió tu solicitud y una persona te contactará pronto.",
        },
      }),
  };
}

async function sendAppointmentMessage(input: {
  apiKey: string | undefined;
  fetchImpl: typeof fetch;
  message: ManualAppointmentTransactionalMessage;
  now: () => Date;
  requireConnection: typeof requireWhatsAppConnectionReady;
  reserveSendSlot: typeof reserveWhatsAppSendSlot;
}) {
  const route =
    input.message.route ??
    ({
      kind: "text",
      text:
        input.message.type === "manual-confirmation"
          ? "Tu cita ha sido confirmada por la Clínica."
          : "La Clínica canceló tu cita.",
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
    reserveSendSlot: input.reserveSendSlot,
    route,
  });
}

async function sendReminder(input: {
  apiKey: string | undefined;
  fetchImpl: typeof fetch;
  input: Parameters<AppointmentReminderSender["send"]>[0];
  now: () => Date;
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
    reserveSendSlot: input.reserveSendSlot,
    route,
  });
}

async function sendKapsoMessage(input: {
  apiKey: string | undefined;
  clinicId: string;
  fetchImpl: typeof fetch;
  idempotencyKey: string;
  now: () => Date;
  recipientBusinessScopedUserId?: string | null;
  recipientPhoneE164: string | null;
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
  const waitMs = await input.reserveSendSlot({
    clinicId: input.clinicId,
    now: input.now(),
    phoneNumberId: connection.phoneNumberId,
  });
  if (waitMs > 0) await waitForRateLimit(waitMs);

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
        body: JSON.stringify(
          requestBody({
            idempotencyKey: input.idempotencyKey,
            recipientBusinessScopedUserId: input.recipientBusinessScopedUserId,
            recipientPhoneE164: input.recipientPhoneE164,
            route: input.route,
          }),
        ),
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
  const text = await readResponseText(response);
  const payload = parseJson(text);
  if (!response.ok) {
    const retryable =
      response.status === 409 ||
      response.status === 429 ||
      response.status === 408 ||
      response.status >= 500;
    throw new KapsoWhatsAppProviderError({
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
  }

  const providerMessageId = readMessageId(payload);
  if (providerMessageId === null) {
    throw new KapsoWhatsAppProviderError({
      ambiguous: true,
      message: "Kapso aceptó la solicitud sin devolver el ID del mensaje",
      rateLimit,
      retryable: false,
      status: response.status,
    });
  }
  return { providerMessageId, status: "accepted" };
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
      await requireWhatsAppConnectionReady({
        clinicId: input.clinicId,
        provider: "kapso",
      });
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
