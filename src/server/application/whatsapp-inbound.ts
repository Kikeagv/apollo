import type { KapsoInboundMessage } from "~/domain/whatsapp-inbound";

const SERVICE_WINDOW_MS = 24 * 60 * 60_000;

export type WhatsAppInboundEventStatus =
  | "awaiting-consent"
  | "conflict"
  | "ignored"
  | "pending"
  | "processed"
  | "processing"
  | "rejected";

export type WhatsAppInboundEvent = KapsoInboundMessage & {
  attempts: number;
  eventId: string;
  idempotencyKey: string;
  leaseToken: string | null;
  receivedAt: Date;
  status: WhatsAppInboundEventStatus;
};

export type WhatsAppInboundResolution =
  | {
      clinicId: string;
      contactId: string;
      identityId: string;
      kind: "matched";
      recipientBusinessScopedUserId: string | null;
      recipientPhoneE164: string | null;
    }
  | {
      kind:
        | "connection-not-ready"
        | "customer-mismatch"
        | "unknown-connection"
        | "unknown-contact";
      reason: string;
    }
  | { kind: "conflict"; reason: string };

export type WhatsAppInboundStore = {
  claimDueMessages(input: {
    limit: number;
    now: Date;
  }): Promise<WhatsAppInboundEvent[]>;
  markAwaitingConsent(input: {
    consentReference?: string | null;
    eventId: string;
    leaseToken: string;
    processedAt: Date;
  }): Promise<void>;
  getAssistantResponse(input: {
    eventId: string;
    leaseToken: string;
  }): Promise<string | null>;
  markConflict(input: {
    eventId: string;
    leaseToken: string;
    processedAt: Date;
    reason: string;
  }): Promise<void>;
  markIgnored(input: {
    eventId: string;
    leaseToken: string;
    processedAt: Date;
    reason: string;
  }): Promise<void>;
  markProcessed(input: {
    consentReference: string;
    eventId: string;
    leaseToken: string;
    processedAt: Date;
  }): Promise<void>;
  markRejected(input: {
    eventId: string;
    leaseToken: string;
    processedAt: Date;
    reason: string;
  }): Promise<void>;
  saveAssistantResponse(input: {
    eventId: string;
    leaseToken: string;
    responseText: string;
  }): Promise<void>;
  resolveMessage(input: {
    message: WhatsAppInboundEvent;
  }): Promise<WhatsAppInboundResolution>;
  scheduleRetry(input: {
    eventId: string;
    leaseToken: string;
    now: Date;
    reason: string;
  }): Promise<void>;
  withConversationLock<T>(input: {
    clinicId: string;
    conversationId: string | null;
    operation: () => Promise<T>;
  }): Promise<T>;
};

export type WhatsAppInboundConsentDecision =
  | { kind: "accepted"; reference: string }
  | {
      kind: "pending";
      prompt?: { buttonLabel?: string; text?: string };
    }
  | { kind: "blocked"; reason: string };

export type WhatsAppInboundConsentGate = {
  check(input: {
    clinicId: string;
    contactId: string;
    identityId: string;
    messageId: string;
    now: Date;
  }): Promise<WhatsAppInboundConsentDecision>;
};

export type WhatsAppInboundAssistant = {
  processText(input: {
    clinicId: string;
    contactId: string;
    messageId: string;
    now: Date;
    text: string;
  }): Promise<{ text: string }>;
};

export type WhatsAppInboundReplySender = {
  send(input: {
    buttonLabel?: string;
    clinicId: string;
    idempotencyKey: string;
    recipientBusinessScopedUserId: string | null;
    recipientPhoneE164: string | null;
    text: string;
  }): Promise<void>;
};

export type KapsoInboundWorkerResult = {
  awaitingConsent: number;
  claimed: number;
  conflicts: number;
  ignored: number;
  processed: number;
  rejected: number;
  retried: number;
};

/** Gate seguro hasta que APO-93 conecte el consentimiento vigente y su evidencia. */
export const pendingWhatsAppConsentGate: WhatsAppInboundConsentGate = {
  async check() {
    return { kind: "pending" };
  },
};

/** Consume eventos ya autenticados, sin abrir una segunda ruta para el agente. */
export async function runKapsoInboundWorker(
  input: { limit?: number; now: Date },
  store: WhatsAppInboundStore,
  assistant: WhatsAppInboundAssistant,
  consentGate: WhatsAppInboundConsentGate,
  replySender: WhatsAppInboundReplySender,
): Promise<KapsoInboundWorkerResult> {
  const events = await store.claimDueMessages({
    limit: input.limit ?? 20,
    now: input.now,
  });
  const result: KapsoInboundWorkerResult = {
    awaitingConsent: 0,
    claimed: events.length,
    conflicts: 0,
    ignored: 0,
    processed: 0,
    rejected: 0,
    retried: 0,
  };

  for (const event of events) {
    try {
      const outcome = await processInboundEvent({
        event,
        now: input.now,
        store,
        assistant,
        consentGate,
        replySender,
      });
      result[outcome] += 1;
    } catch (error) {
      const reason = errorMessage(error);
      const leaseToken = requireLeaseToken(event);
      await store.scheduleRetry({
        eventId: event.eventId,
        leaseToken,
        now: input.now,
        reason,
      });
      result.retried += 1;
    }
  }

  return result;
}

async function processInboundEvent(input: {
  assistant: WhatsAppInboundAssistant;
  consentGate: WhatsAppInboundConsentGate;
  event: WhatsAppInboundEvent;
  now: Date;
  replySender: WhatsAppInboundReplySender;
  store: WhatsAppInboundStore;
}): Promise<"awaitingConsent" | "conflicts" | "ignored" | "processed"> {
  const { event, now, store } = input;
  const leaseToken = requireLeaseToken(event);

  if (!isAssistantEligibleMessage(event)) {
    await store.markIgnored({
      eventId: event.eventId,
      leaseToken,
      processedAt: now,
      reason: ineligibilityReason(event),
    });
    return "ignored";
  }

  const serviceWindowExpiresAt = new Date(
    (event.messageTimestamp ?? event.receivedAt).valueOf() + SERVICE_WINDOW_MS,
  );
  if (serviceWindowExpiresAt <= now) {
    await store.markIgnored({
      eventId: event.eventId,
      leaseToken,
      processedAt: now,
      reason: "La Ventana de servicio de WhatsApp ya expiró",
    });
    return "ignored";
  }

  const resolved = await store.resolveMessage({ message: event });
  if (resolved.kind === "conflict") {
    await store.markConflict({
      eventId: event.eventId,
      leaseToken,
      processedAt: now,
      reason: resolved.reason,
    });
    return "conflicts";
  }
  if (resolved.kind !== "matched") {
    await store.markIgnored({
      eventId: event.eventId,
      leaseToken,
      processedAt: now,
      reason: resolved.reason,
    });
    return "ignored";
  }

  const consent = await input.consentGate.check({
    clinicId: resolved.clinicId,
    contactId: resolved.contactId,
    identityId: resolved.identityId,
    messageId: event.id,
    now,
  });
  if (consent.kind === "blocked") {
    await store.markIgnored({
      eventId: event.eventId,
      leaseToken,
      processedAt: now,
      reason: consent.reason,
    });
    return "ignored";
  }

  if (consent.kind === "pending") {
    await input.replySender.send({
      buttonLabel: consent.prompt?.buttonLabel ?? "CONTINUAR",
      clinicId: resolved.clinicId,
      idempotencyKey: event.id,
      recipientBusinessScopedUserId: resolved.recipientBusinessScopedUserId,
      recipientPhoneE164: resolved.recipientPhoneE164,
      text:
        consent.prompt?.text ??
        "Para continuar, revisa el Aviso de privacidad y las condiciones de la Clínica. Pulsa CONTINUAR para aceptar.",
    });
    await store.markAwaitingConsent({
      consentReference: null,
      eventId: event.eventId,
      leaseToken,
      processedAt: now,
    });
    return "awaitingConsent";
  }

  const response = await store.withConversationLock({
    clinicId: resolved.clinicId,
    conversationId: event.conversationId,
    operation: async () => {
      const persistedResponse = await store.getAssistantResponse({
        eventId: event.eventId,
        leaseToken,
      });
      if (persistedResponse !== null) return { text: persistedResponse };
      const generated = await input.assistant.processText({
        clinicId: resolved.clinicId,
        contactId: resolved.contactId,
        messageId: event.id,
        now,
        text: event.text,
      });
      await store.saveAssistantResponse({
        eventId: event.eventId,
        leaseToken,
        responseText: generated.text,
      });
      return generated;
    },
  });
  if (response.text.trim() !== "") {
    await input.replySender.send({
      clinicId: resolved.clinicId,
      idempotencyKey: event.id,
      recipientBusinessScopedUserId: resolved.recipientBusinessScopedUserId,
      recipientPhoneE164: resolved.recipientPhoneE164,
      text: response.text,
    });
  }
  await store.markProcessed({
    consentReference: consent.reference,
    eventId: event.eventId,
    leaseToken,
    processedAt: now,
  });
  return "processed";
}

function isAssistantEligibleMessage(
  event: WhatsAppInboundEvent,
): event is WhatsAppInboundEvent & { text: string } {
  return (
    event.direction === "inbound" &&
    event.origin === "cloud_api" &&
    event.type === "text" &&
    event.text !== null
  );
}

function ineligibilityReason(event: WhatsAppInboundEvent) {
  if (event.direction !== "inbound") return "El evento Kapso es saliente";
  if (event.origin !== "cloud_api")
    return `El origen Kapso ${event.origin} no despierta al asistente`;
  return `El tipo Kapso ${event.type} no es texto procesable`;
}

function requireLeaseToken(event: WhatsAppInboundEvent) {
  if (event.leaseToken === null) {
    throw new Error("El evento entrante no tiene una concesión activa");
  }
  return event.leaseToken;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Error desconocido";
}
