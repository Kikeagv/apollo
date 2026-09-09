export const kapsoInboundMessageOrigins = [
  "cloud_api",
  "business_app",
  "history_sync",
] as const;

export type KapsoInboundMessageOrigin =
  (typeof kapsoInboundMessageOrigins)[number] | "unknown";

export type KapsoInboundMessageDirection = "inbound" | "outbound" | "unknown";

export type KapsoInboundMessage = {
  batchSequence: number | null;
  businessScopedUserId: string | null;
  conversationId: string | null;
  customerId: string | null;
  direction: KapsoInboundMessageDirection;
  eventName: "whatsapp.message.received";
  fromWaId: string | null;
  id: string;
  interactiveAction?: "continue" | null;
  messageTimestamp: Date | null;
  origin: KapsoInboundMessageOrigin;
  parentBusinessScopedUserId: string | null;
  phoneE164: string | null;
  phoneNumberId: string;
  rawPayload: Record<string, unknown>;
  text: string | null;
  type: string;
  username: string | null;
};

export class KapsoInboundMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KapsoInboundMessageError";
  }
}

/**
 * Normaliza el formato v2 de Kapso. El mismo puerto acepta una entrega
 * individual o el envelope batched que Kapso usa cuando está activo el
 * buffering; cada elemento conserva su propio id y secuencia.
 */
export function parseKapsoInboundMessagePayload(
  payload: unknown,
): KapsoInboundMessage[] {
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
  return entries.map((entry, index) =>
    parseInboundMessage(entry, {
      batchSequence: firstSequence === null ? null : firstSequence + index,
      fallbackPhoneNumberId: readString(root.phone_number_id),
    }),
  );
}

function parseInboundMessage(
  payload: Record<string, unknown>,
  input: { batchSequence: number | null; fallbackPhoneNumberId: string | null },
): KapsoInboundMessage {
  const message = asRecord(
    payload.message,
    "El payload de mensaje Kapso no contiene message",
  );
  const conversation = asRecord(payload.conversation);
  const kapso = asRecord(message.kapso);
  const id = readString(message.id);
  const phoneNumberId =
    readString(payload.phone_number_id) ??
    readString(message.phone_number_id) ??
    readString(kapso.phone_number_id) ??
    readString(conversation.phone_number_id) ??
    input.fallbackPhoneNumberId;
  if (id === null || phoneNumberId === null) {
    throw new KapsoInboundMessageError(
      "El mensaje Kapso requiere id y phone_number_id",
    );
  }

  const rawFrom = firstString(
    message.from_wa_id,
    message.wa_id,
    message.from,
    conversation.wa_id,
  );
  const fromWaId =
    rawFrom !== null && !isBusinessScopedUserId(rawFrom) ? rawFrom : null;
  const phone = firstString(
    message.phone_e164,
    message.phone_number,
    message.from_phone_number,
    conversation.phone_e164,
    conversation.phone_number,
  );
  const type = readString(message.type) ?? "unknown";
  const rawText = asRecord(message.text)?.body;

  return {
    batchSequence: input.batchSequence,
    businessScopedUserId: firstString(
      message.business_scoped_user_id,
      message.from_user_id,
      kapso.business_scoped_user_id,
      conversation.business_scoped_user_id,
      isBusinessScopedUserId(rawFrom) ? rawFrom : null,
    ),
    conversationId: readString(conversation.id),
    customerId: firstString(
      asRecord(payload.customer)?.id,
      payload.customer_id,
      payload.customerId,
    ),
    direction: parseDirection(firstString(kapso.direction, message.direction)),
    eventName: "whatsapp.message.received",
    fromWaId,
    id,
    interactiveAction: parseInteractiveAction(message, type),
    messageTimestamp: parseEpochTimestamp(message.timestamp),
    origin: parseOrigin(readString(kapso.origin)),
    parentBusinessScopedUserId: firstString(
      message.parent_business_scoped_user_id,
      message.from_parent_user_id,
      kapso.parent_business_scoped_user_id,
      conversation.parent_business_scoped_user_id,
    ),
    phoneE164:
      phone === null || !isPhoneCandidate(phone)
        ? null
        : normalizePhoneNumber(phone),
    phoneNumberId,
    rawPayload: payload,
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

function parseDirection(value: string | null): KapsoInboundMessageDirection {
  if (value === "inbound" || value === "outbound") return value;
  return "unknown";
}

function parseOrigin(value: string | null): KapsoInboundMessageOrigin {
  if (
    value !== null &&
    (kapsoInboundMessageOrigins as readonly string[]).includes(value)
  ) {
    return value as KapsoInboundMessageOrigin;
  }
  return "unknown";
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
