import {
  type WhatsAppInboundMessage,
  type WhatsAppInboundMessageDirection,
  type WhatsAppInboundMessageOrigin,
  type WhatsAppInboundEventName,
} from "~/domain/whatsapp-inbound";

export class KapsoInboundMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KapsoInboundMessageError";
  }
}

/** Adapta el JSON v2 de Kapso a la entrada neutral del canal de WhatsApp. */
export function parseKapsoInboundMessagePayload(
  payload: unknown,
  eventName: WhatsAppInboundEventName = "whatsapp.message.received",
): WhatsAppInboundMessage[] {
  const root = asRecord(payload, "El payload de mensaje Kapso es inválido");
  const entries = Array.isArray(root.data)
    ? root.data.map((entry) =>
        asRecord(entry, "El elemento del lote Kapso es inválido"),
      )
    : [root];
  if (entries.length === 0) {
    throw new KapsoInboundMessageError("El lote Kapso no contiene mensajes");
  }

  const firstSequence = readInteger(asRecord(root.batch_info)?.first_sequence);
  const rootCustomerReference = firstString(
    asRecord(root.customer)?.id,
    root.customer_id,
    root.customerId,
  );
  return entries.map((entry, index) =>
    parseInboundMessage(entry, {
      batchFirstSequence: firstSequence,
      batchSequence: firstSequence === null ? null : firstSequence + index,
      eventName,
      fallbackConnectionReference: readString(root.phone_number_id),
      fallbackCustomerReference: rootCustomerReference,
    }),
  );
}

function parseInboundMessage(
  payload: Record<string, unknown>,
  input: {
    batchFirstSequence: number | null;
    batchSequence: number | null;
    eventName: WhatsAppInboundEventName;
    fallbackConnectionReference: string | null;
    fallbackCustomerReference: string | null;
  },
): WhatsAppInboundMessage {
  const message = asRecord(
    payload.message,
    "El payload de mensaje Kapso no contiene message",
  );
  const conversation = asRecord(payload.conversation);
  const kapso = asRecord(message.kapso);
  const id = readString(message.id);
  const connectionReference =
    readString(payload.phone_number_id) ??
    readString(message.phone_number_id) ??
    readString(kapso.phone_number_id) ??
    readString(conversation.phone_number_id) ??
    input.fallbackConnectionReference;
  if (id === null || connectionReference === null) {
    throw new KapsoInboundMessageError(
      "El mensaje Kapso requiere id y phone_number_id",
    );
  }

  const direction = parseDirection(
    firstString(kapso.direction, message.direction),
  );
  const to = optionalRecord(message.to);
  const recipient = optionalRecord(message.recipient);
  const rawCounterparty = firstString(
    ...(direction === "outbound"
      ? [
          message.to_wa_id,
          message.to,
          to.wa_id,
          message.recipient,
          recipient.wa_id,
          message.to_phone_number,
          message.recipient_phone_number,
          message.to_user_id,
          message.recipient_user_id,
        ]
      : [message.from_wa_id, message.wa_id, message.from, conversation.wa_id]),
  );
  const fromWaId =
    rawCounterparty !== null && !isBusinessScopedUserId(rawCounterparty)
      ? rawCounterparty
      : null;
  const phone = firstString(
    ...(direction === "outbound"
      ? [
          message.to_phone_number,
          message.recipient_phone_number,
          message.to,
          to.phone_number,
          to.wa_id,
          message.recipient,
          recipient.phone_number,
          recipient.wa_id,
        ]
      : [message.phone_e164, message.phone_number, message.from_phone_number]),
    message.phone_e164,
    message.phone_number,
    conversation.phone_e164,
    conversation.phone_number,
  );
  const type = readString(message.type) ?? "unknown";
  const rawText = asRecord(message.text)?.body;
  const interactiveAction = parseInteractiveAction(message, type);
  const origin = parseOrigin(readString(kapso.origin));

  return {
    batchFirstSequence: input.batchFirstSequence,
    batchSequence: input.batchSequence,
    businessScopedUserId: firstString(
      ...(direction === "outbound"
        ? [
            message.to_user_id,
            message.to_business_scoped_user_id,
            message.recipient_user_id,
            message.recipient_business_scoped_user_id,
            to.business_scoped_user_id,
            recipient.business_scoped_user_id,
          ]
        : [message.business_scoped_user_id, message.from_user_id]),
      kapso.business_scoped_user_id,
      conversation.business_scoped_user_id,
      isBusinessScopedUserId(rawCounterparty) ? rawCounterparty : null,
    ),
    connectionReference,
    conversationId: readString(conversation.id),
    customerReference: firstString(
      asRecord(payload.customer)?.id,
      payload.customer_id,
      payload.customerId,
      input.fallbackCustomerReference,
    ),
    direction,
    eventName: input.eventName,
    fromWaId,
    id,
    interactiveAction,
    messageTimestamp: parseEpochTimestamp(message.timestamp),
    origin,
    parentBusinessScopedUserId: firstString(
      ...(direction === "outbound"
        ? [
            message.to_parent_business_scoped_user_id,
            message.to_parent_user_id,
            message.recipient_parent_business_scoped_user_id,
            message.recipient_parent_user_id,
          ]
        : [
            message.parent_business_scoped_user_id,
            message.from_parent_user_id,
          ]),
      kapso.parent_business_scoped_user_id,
      conversation.parent_business_scoped_user_id,
    ),
    phoneE164:
      phone === null || !isPhoneCandidate(phone)
        ? null
        : normalizePhoneNumber(phone),
    rawPayload:
      type === "text" || interactiveAction === "continue"
        ? payload
        : projectInboundMetadata({
            conversation,
            kapso,
            message,
            payload,
            type,
          }),
    text: typeof rawText === "string" ? rawText : null,
    type,
    username: firstString(
      message.username,
      kapso.username,
      conversation.username,
    ),
  };
}

function parseInteractiveAction(
  message: Record<string, unknown>,
  type: string,
): "continue" | null {
  if (type !== "interactive") return null;
  const interactive = asRecord(message.interactive);
  if (readString(interactive.type) !== "button_reply") return null;
  const buttonReply = asRecord(interactive.button_reply);
  const button = asRecord(interactive.button);
  const buttonIds = [
    buttonReply.id,
    buttonReply.payload,
    button.id,
    button.payload,
  ]
    .map(readString)
    .filter((value): value is string => value !== null);
  if (
    buttonIds.some((value) => value === "CONTINUAR" || value === "continue")
  ) {
    return "continue";
  }
  const buttonTitles = [buttonReply.title, button.title]
    .map(readString)
    .filter((value): value is string => value !== null);
  return buttonIds.length === 0 && buttonTitles.includes("CONTINUAR")
    ? "continue"
    : null;
}

/** Conserva sólo metadatos para multimedia y tipos no soportados. */
function projectInboundMetadata(input: {
  conversation: Record<string, unknown>;
  kapso: Record<string, unknown>;
  message: Record<string, unknown>;
  payload: Record<string, unknown>;
  type: string;
}) {
  const media = asRecord(input.message[input.type]);
  return compactRecord({
    batch_info: compactRecord({
      first_sequence: readInteger(
        asRecord(input.payload.batch_info).first_sequence,
      ),
    }),
    conversation: compactRecord({
      business_scoped_user_id: readString(
        input.conversation.business_scoped_user_id,
      ),
      id: readString(input.conversation.id),
      parent_business_scoped_user_id: readString(
        input.conversation.parent_business_scoped_user_id,
      ),
      phone_e164: readString(input.conversation.phone_e164),
      phone_number: readString(input.conversation.phone_number),
      phone_number_id: readString(input.conversation.phone_number_id),
      username: readString(input.conversation.username),
      wa_id: readString(input.conversation.wa_id),
    }),
    customer: compactRecord({
      id: firstString(
        asRecord(input.payload.customer).id,
        input.payload.customer_id,
        input.payload.customerId,
      ),
    }),
    message: compactRecord({
      business_scoped_user_id: readString(
        input.message.business_scoped_user_id,
      ),
      direction: readString(input.message.direction),
      from: readString(input.message.from),
      from_phone_number: readString(input.message.from_phone_number),
      from_user_id: readString(input.message.from_user_id),
      from_wa_id: readString(input.message.from_wa_id),
      id: readString(input.message.id),
      interactive_type: readString(asRecord(input.message.interactive).type),
      kapso: compactRecord({
        direction: readString(input.kapso.direction),
        origin: readString(input.kapso.origin),
      }),
      parent_business_scoped_user_id: readString(
        input.message.parent_business_scoped_user_id,
      ),
      phone_e164: readString(input.message.phone_e164),
      phone_number: readString(input.message.phone_number),
      phone_number_id: readString(input.message.phone_number_id),
      timestamp: readScalar(input.message.timestamp),
      type: input.type,
      username: readString(input.message.username),
      wa_id: readString(input.message.wa_id),
      [input.type]: compactRecord({
        filename: firstString(media.filename, media.file_name),
        id: firstString(media.id, media.media_id),
        mime_type: firstString(media.mime_type, media.mimeType),
        sha256: readString(media.sha256),
      }),
    }),
    phone_number_id: readString(input.payload.phone_number_id),
  });
}

function compactRecord(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([, value]) => value !== null && value !== undefined,
    ),
  );
}

function readScalar(value: unknown) {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined;
}

function asRecord(
  value: unknown,
  message = "El objeto Kapso es inválido",
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    if (value === undefined || value === null) return {};
    throw new KapsoInboundMessageError(message);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const result = readString(value);
    if (result !== null) return result;
  }
  return null;
}

function isPhoneCandidate(value: string | null) {
  return value !== null && /^[+\d][\d\s().-]{7,20}$/.test(value);
}

function isBusinessScopedUserId(value: string | null) {
  return value?.startsWith("US.") === true;
}

function normalizePhoneNumber(value: string) {
  const normalized = value.replace(/[\s().-]/g, "");
  if (!/^\+?[1-9]\d{7,14}$/.test(normalized)) {
    throw new KapsoInboundMessageError(
      "El número del remitente Kapso es inválido",
    );
  }
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

function parseDirection(value: string | null): WhatsAppInboundMessageDirection {
  if (value === "inbound" || value === "outbound") return value;
  return "unknown";
}

function parseOrigin(value: string | null): WhatsAppInboundMessageOrigin {
  switch (value) {
    case "cloud_api":
      return "api";
    case "business_app":
      return "business-app";
    case "history_sync":
      return "history-sync";
    default:
      return "unknown";
  }
}

function parseEpochTimestamp(value: unknown): Date | null {
  const timestamp =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : (() => {
          const stringValue = readString(value);
          return stringValue !== null && /^\d+$/.test(stringValue)
            ? Number(stringValue)
            : null;
        })();
  if (timestamp === null) return null;
  const date = new Date(timestamp * 1_000);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function readInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result === "" ? null : result;
}
