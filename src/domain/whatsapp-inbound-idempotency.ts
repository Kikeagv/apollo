export type WhatsAppInboundDuplicateCandidate = {
  eventId: string;
  idempotencyKey: string;
  messageId: string;
  phoneNumberId: string;
  customerReference: string | null;
};

export class WhatsAppInboundIdempotencyConflictError extends Error {
  constructor() {
    super(
      "La clave de idempotencia ya pertenece a otro mensaje entrante de WhatsApp",
    );
    this.name = "WhatsAppInboundIdempotencyConflictError";
  }
}

/**
 * Distingue un replay legítimo de una clave externa reutilizada para otro
 * mensaje. El mensaje identifica al número receptor y al ID de Kapso; la
 * clave de webhook nunca puede ocultar una colisión entre ambos.
 */
export function resolveWhatsAppInboundDuplicate(input: {
  candidates: WhatsAppInboundDuplicateCandidate[];
  idempotencyKey: string;
  messageId: string;
  phoneNumberId: string;
  customerReference: string | null;
}) {
  const sameMessage = (candidate: WhatsAppInboundDuplicateCandidate) =>
    candidate.messageId === input.messageId &&
    candidate.phoneNumberId === input.phoneNumberId &&
    candidate.customerReference === input.customerReference;

  if (
    input.candidates.some(
      (candidate) =>
        candidate.idempotencyKey === input.idempotencyKey &&
        !sameMessage(candidate),
    )
  ) {
    throw new WhatsAppInboundIdempotencyConflictError();
  }

  const duplicate =
    input.candidates.find(sameMessage) ??
    input.candidates.find(
      (candidate) => candidate.idempotencyKey === input.idempotencyKey,
    );
  return duplicate === undefined ? undefined : { eventId: duplicate.eventId };
}
