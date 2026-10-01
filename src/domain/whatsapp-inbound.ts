export const whatsappInboundMessageOrigins = [
  "api",
  "business-app",
  "history-sync",
] as const;

export type WhatsAppInboundMessageOrigin =
  (typeof whatsappInboundMessageOrigins)[number] | "unknown";

export type WhatsAppInboundMessageDirection =
  "inbound" | "outbound" | "unknown";

export type WhatsAppInboundEventName =
  "whatsapp.message.received" | "whatsapp.message.sent";

/** Entrada neutral del canal; las referencias externas son opacas al dominio. */
export type WhatsAppInboundMessage = {
  batchFirstSequence: number | null;
  batchSequence: number | null;
  businessScopedUserId: string | null;
  connectionReference: string;
  conversationId: string | null;
  customerReference: string | null;
  direction: WhatsAppInboundMessageDirection;
  eventName: WhatsAppInboundEventName;
  fromWaId: string | null;
  id: string;
  interactiveAction?: "continue" | null;
  messageTimestamp: Date | null;
  origin: WhatsAppInboundMessageOrigin;
  parentBusinessScopedUserId: string | null;
  phoneE164: string | null;
  rawPayload: Record<string, unknown>;
  text: string | null;
  type: string;
  username: string | null;
};

export type WhatsAppInboundHandling =
  "assistant" | "business-app" | "history-sync" | "not-inbound" | "unsupported";

/** Convierte el tipo del proveedor en una etiqueta apta para la bandeja humana. */
export function whatsappInboundMessageTypeLabel(type: string | null) {
  switch (type) {
    case "audio":
      return "Audio";
    case "document":
      return "Documento";
    case "image":
      return "Imagen";
    case "interactive":
      return "Interactivo";
    case "location":
      return "Ubicación";
    case "text":
      return "Texto";
    default:
      return "Tipo no soportado";
  }
}

/**
 * Decide qué comportamiento permite el origen antes de resolver una Clínica.
 * CONTINUAR es la única excepción interactiva: pertenece al gate de consentimiento.
 */
export function classifyWhatsAppInboundMessage(
  message: Pick<
    WhatsAppInboundMessage,
    "direction" | "interactiveAction" | "origin" | "text" | "type"
  >,
): WhatsAppInboundHandling {
  // Un outbound manual de Business App es la señal de takeover humano; por
  // eso este origen se evalúa antes de la dirección del evento.
  if (message.origin === "business-app") return "business-app";
  if (message.origin === "history-sync") return "history-sync";
  if (message.direction !== "inbound") return "not-inbound";
  if (
    message.origin === "api" &&
    ((message.type === "text" && message.text !== null) ||
      (message.type === "interactive" &&
        message.interactiveAction === "continue"))
  ) {
    return "assistant";
  }
  return "unsupported";
}

/**
 * El phone_number_id ya resuelve una Conexión única. Si Kapso incluye customer,
 * se exige que coincida; algunos webhooks normalizados omiten esa referencia.
 */
export function matchesWhatsAppCustomer(input: {
  connectionCustomerReference: string;
  messageCustomerReference: string | null;
}) {
  return (
    input.messageCustomerReference === null ||
    input.messageCustomerReference === input.connectionCustomerReference
  );
}
