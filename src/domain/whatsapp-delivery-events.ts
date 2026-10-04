import type { WhatsAppDeliveryStatus } from "./whatsapp-delivery";

export const kapsoDeliveryStatusEventNames = [
  "whatsapp.message.sent",
  "whatsapp.message.delivered",
  "whatsapp.message.read",
  "whatsapp.message.failed",
] as const;

export type KapsoDeliveryStatusEventName =
  (typeof kapsoDeliveryStatusEventNames)[number];

export type KapsoDeliveryStatusEvent = {
  correlationKey: string | null;
  error: string | null;
  eventName: KapsoDeliveryStatusEventName;
  messageId: string;
  phoneNumberId: string;
  rawPayload: Record<string, unknown>;
  status: Exclude<WhatsAppDeliveryStatus, "accepted">;
};

export class KapsoDeliveryStatusEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KapsoDeliveryStatusEventError";
  }
}

export function parseKapsoDeliveryStatusPayload(
  eventName: string,
  payload: unknown,
): KapsoDeliveryStatusEvent {
  if (!isKapsoDeliveryStatusEventName(eventName)) {
    throw new KapsoDeliveryStatusEventError(
      "Evento de estado Kapso no soportado",
    );
  }
  const root = asRecord(payload);
  const message = asRecord(root.message);
  const kapso = asRecord(message.kapso);
  const status = eventStatus(eventName);
  const messageId = firstString(
    message.id,
    root.message_id,
    root.messageId,
    root.id,
  );
  const phoneNumberId = firstString(
    root.phone_number_id,
    root.phoneNumberId,
    message.phone_number_id,
    kapso.phone_number_id,
  );
  if (messageId === null || phoneNumberId === null) {
    throw new KapsoDeliveryStatusEventError(
      "El estado Kapso requiere id y phone_number_id",
    );
  }
  const nestedStatuses = [root.statuses, message.statuses, kapso.statuses]
    .filter(Array.isArray)
    .flatMap((value) => value.map(asRecord));
  const matchingStatus = nestedStatuses.find(
    (candidate) => firstString(candidate.id) === messageId,
  );

  return {
    correlationKey: firstString(
      root.biz_opaque_callback_data,
      root.idempotency_key,
      message.biz_opaque_callback_data,
      message.idempotency_key,
      kapso.biz_opaque_callback_data,
      matchingStatus?.biz_opaque_callback_data,
      matchingStatus?.idempotency_key,
    ),
    error: readError(root, message, kapso),
    eventName,
    messageId,
    phoneNumberId,
    rawPayload: root,
    status,
  };
}

export function isKapsoDeliveryStatusEventName(
  value: string,
): value is KapsoDeliveryStatusEventName {
  return (kapsoDeliveryStatusEventNames as readonly string[]).includes(value);
}

function eventStatus(
  eventName: KapsoDeliveryStatusEventName,
): Exclude<WhatsAppDeliveryStatus, "accepted"> {
  return eventName.slice("whatsapp.message.".length) as Exclude<
    WhatsAppDeliveryStatus,
    "accepted"
  >;
}

function readError(...records: Record<string, unknown>[]): string | null {
  for (const record of records) {
    const error = asRecord(record.error);
    const value = firstString(
      record.error,
      record.error_message,
      record.failure_reason,
      error.message,
      error.title,
    );
    if (value !== null) return value;
  }
  return null;
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
