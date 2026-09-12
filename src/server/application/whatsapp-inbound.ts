import {
  classifyWhatsAppInboundMessage,
  type WhatsAppInboundMessage,
} from "~/domain/whatsapp-inbound";
import {
  classifyWhatsAppConsentSafeRoute,
  isWhatsAppConsentOptOut,
  type WhatsAppConsentSafeRoute,
} from "~/domain/whatsapp-consent";
import type { ConversationEscalationTrigger } from "./conversation-escalations";
import type { WhatsAppConsentGate } from "./whatsapp-consent";

export type {
  WhatsAppConsentDecision as WhatsAppInboundConsentDecision,
  WhatsAppConsentGate as WhatsAppInboundConsentGate,
} from "./whatsapp-consent";

const SERVICE_WINDOW_MS = 24 * 60 * 60_000;
const UNSUPPORTED_MESSAGE_RESPONSE =
  "Recibimos tu mensaje. Una persona de la Clínica te atenderá pronto.";

export type WhatsAppInboundEventStatus =
  | "awaiting-consent"
  | "conflict"
  | "ignored"
  | "pending"
  | "processed"
  | "processing"
  | "rejected";

export type WhatsAppInboundEvent = WhatsAppInboundMessage & {
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
    consentReference: string | null;
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
  recordOperationalAlert(input: {
    customerReference: string | null;
    eventId: string;
    nextAction: string;
    now: Date;
    connectionReference: string;
    reason: string;
  }): Promise<void>;
  saveAssistantResponse(input: {
    eventId: string;
    leaseToken: string;
    responseText: string;
  }): Promise<void>;
  resolveMessage(input: {
    mode?: "historical" | "live";
    message: WhatsAppInboundEvent;
  }): Promise<WhatsAppInboundResolution>;
  scheduleRetry(input: {
    eventId: string;
    leaseToken: string;
    now: Date;
    reason: string;
  }): Promise<void>;
  suppressPendingReminderDeliveries?(input: {
    clinicId: string;
    contactId: string;
    now: Date;
  }): Promise<number>;
  suppressPendingWhatsAppDeliveries?(input: {
    clinicId: string;
    contactId: string;
    now: Date;
  }): Promise<number>;
  reactivatePendingWhatsAppDeliveries?(input: {
    clinicId: string;
    consentReference: string;
    contactId: string;
    now: Date;
  }): Promise<number>;
  withConversationLock<T>(input: {
    clinicId: string;
    conversationId: string | null;
    operation: () => Promise<T>;
  }): Promise<T>;
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

export type WhatsAppInboundSafeRoute = {
  process(input: {
    clinicId: string;
    contactId: string;
    messageId: string;
    now: Date;
    route: WhatsAppConsentSafeRoute;
    text: string;
  }): Promise<{ text: string }>;
};

export type WhatsAppInboundHumanTakeover = {
  isActive(input: { clinicId: string; contactId: string }): Promise<boolean>;
  activate(input: {
    clinicId: string;
    contactId: string;
    messageId: string;
    messageType: string;
    now: Date;
    trigger: Extract<
      ConversationEscalationTrigger,
      "business-app" | "unsupported-message"
    >;
  }): Promise<void>;
};

export type WhatsAppInboundReplySender = {
  send(input: {
    buttonLabel?: string;
    clinicId: string;
    idempotencyKey: string;
    recipientBusinessScopedUserId: string | null;
    recipientPhoneE164: string | null;
    serviceWindowExpiresAt?: Date | null;
    text: string;
  }): Promise<void>;
};

export type KapsoInboundWorkerResult = {
  awaitingConsent: number;
  claimed: number;
  conflicts: number;
  ignored: number;
  optedOut: number;
  processed: number;
  rejected: number;
  retried: number;
};

/** Consume eventos ya autenticados, sin abrir una segunda ruta para el agente. */
export async function runKapsoInboundWorker(
  input: { limit?: number; now: Date },
  store: WhatsAppInboundStore,
  assistant: WhatsAppInboundAssistant,
  consentGate: WhatsAppConsentGate,
  replySender: WhatsAppInboundReplySender,
  safeRoute: WhatsAppInboundSafeRoute | undefined,
  takeover: WhatsAppInboundHumanTakeover,
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
    optedOut: 0,
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
        safeRoute,
        takeover,
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
  consentGate: WhatsAppConsentGate;
  event: WhatsAppInboundEvent;
  now: Date;
  replySender: WhatsAppInboundReplySender;
  safeRoute?: WhatsAppInboundSafeRoute;
  store: WhatsAppInboundStore;
  takeover: WhatsAppInboundHumanTakeover;
}): Promise<
  | "awaitingConsent"
  | "conflicts"
  | "ignored"
  | "optedOut"
  | "processed"
  | "rejected"
> {
  const { event, now, store } = input;
  const leaseToken = requireLeaseToken(event);
  const handling = classifyWhatsAppInboundMessage(event);

  if (handling === "not-inbound") {
    await store.markIgnored({
      eventId: event.eventId,
      leaseToken,
      processedAt: now,
      reason: notInboundReason(event),
    });
    return "ignored";
  }

  const resolved = await store.resolveMessage({
    message: event,
    mode: handling === "history-sync" ? "historical" : "live",
  });
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
    if (
      resolved.kind === "customer-mismatch" ||
      resolved.kind === "unknown-connection" ||
      resolved.kind === "unknown-contact"
    ) {
      await store.recordOperationalAlert({
        customerReference: event.customerReference,
        eventId: event.eventId,
        nextAction:
          resolved.kind === "unknown-connection"
            ? "Verificar phone_number_id y registrar la Conexión correcta antes de reintentar"
            : resolved.kind === "customer-mismatch"
              ? "Verificar el customer de Kapso y la Conexión antes de reintentar"
              : "Vincular la Identidad de WhatsApp con un Contacto antes de reintentar",
        now,
        connectionReference: event.connectionReference,
        reason: resolved.reason,
      });
      await store.markRejected({
        eventId: event.eventId,
        leaseToken,
        processedAt: now,
        reason: resolved.reason,
      });
      return "rejected";
    }
    await store.markIgnored({
      eventId: event.eventId,
      leaseToken,
      processedAt: now,
      reason: resolved.reason,
    });
    return "ignored";
  }

  const serviceWindowExpiresAt = new Date(
    (event.messageTimestamp ?? event.receivedAt).valueOf() + SERVICE_WINDOW_MS,
  );
  if (
    handling === "assistant" &&
    serviceWindowExpiresAt <= now &&
    !isWhatsAppConsentOptOut(event.text)
  ) {
    await store.markIgnored({
      eventId: event.eventId,
      leaseToken,
      processedAt: now,
      reason: "La Ventana de servicio de WhatsApp ya expiró",
    });
    return "ignored";
  }

  if (handling !== "history-sync") {
    await store.suppressPendingReminderDeliveries?.({
      clinicId: resolved.clinicId,
      contactId: resolved.contactId,
      now,
    });
  }

  if (handling === "history-sync") {
    await store.markProcessed({
      consentReference: null,
      eventId: event.eventId,
      leaseToken,
      processedAt: now,
    });
    return "processed";
  }

  return store.withConversationLock({
    clinicId: resolved.clinicId,
    conversationId: `whatsapp-contact:${resolved.contactId}`,
    operation: async () => {
      if (handling === "business-app" || handling === "unsupported") {
        await input.takeover.activate({
          clinicId: resolved.clinicId,
          contactId: resolved.contactId,
          messageId: event.id,
          messageType: event.type,
          now,
          trigger:
            handling === "business-app"
              ? "business-app"
              : "unsupported-message",
        });
        if (handling === "unsupported" && serviceWindowExpiresAt > now) {
          await input.replySender.send({
            clinicId: resolved.clinicId,
            idempotencyKey: event.id,
            recipientBusinessScopedUserId:
              resolved.recipientBusinessScopedUserId,
            recipientPhoneE164: resolved.recipientPhoneE164,
            serviceWindowExpiresAt,
            text: UNSUPPORTED_MESSAGE_RESPONSE,
          });
        }
        await store.markProcessed({
          consentReference: null,
          eventId: event.eventId,
          leaseToken,
          processedAt: now,
        });
        return "processed";
      }

      if (
        !isWhatsAppConsentOptOut(event.text) &&
        (await input.takeover.isActive({
          clinicId: resolved.clinicId,
          contactId: resolved.contactId,
        }))
      ) {
        await store.markProcessed({
          consentReference: null,
          eventId: event.eventId,
          leaseToken,
          processedAt: now,
        });
        return "processed";
      }

      const consent = await input.consentGate.check({
        clinicId: resolved.clinicId,
        contactId: resolved.contactId,
        identityId: resolved.identityId,
        interactiveAction: event.interactiveAction ?? null,
        messageId: event.id,
        now,
        phoneE164: resolved.recipientPhoneE164,
        text: event.text,
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
        const safeRouteKind = classifyWhatsAppConsentSafeRoute(event.text);
        if (safeRouteKind !== null) {
          if (input.safeRoute === undefined) {
            await store.markIgnored({
              eventId: event.eventId,
              leaseToken,
              processedAt: now,
              reason: "La ruta segura de consentimiento no está disponible",
            });
            return "ignored";
          }
          const persistedResponse = await store.getAssistantResponse({
            eventId: event.eventId,
            leaseToken,
          });
          const response =
            persistedResponse === null
              ? await input.safeRoute.process({
                  clinicId: resolved.clinicId,
                  contactId: resolved.contactId,
                  messageId: event.id,
                  now,
                  route: safeRouteKind,
                  text: event.text ?? "",
                })
              : { text: persistedResponse };
          if (persistedResponse === null) {
            await store.saveAssistantResponse({
              eventId: event.eventId,
              leaseToken,
              responseText: response.text,
            });
          }
          if (response.text.trim() !== "") {
            await input.replySender.send({
              clinicId: resolved.clinicId,
              idempotencyKey: event.id,
              recipientBusinessScopedUserId:
                resolved.recipientBusinessScopedUserId,
              recipientPhoneE164: resolved.recipientPhoneE164,
              serviceWindowExpiresAt,
              text: response.text,
            });
          }
          await store.markProcessed({
            consentReference: null,
            eventId: event.eventId,
            leaseToken,
            processedAt: now,
          });
          return "processed";
        }
        await input.replySender.send({
          buttonLabel: consent.prompt?.buttonLabel ?? "CONTINUAR",
          clinicId: resolved.clinicId,
          idempotencyKey: event.id,
          recipientBusinessScopedUserId: resolved.recipientBusinessScopedUserId,
          recipientPhoneE164: resolved.recipientPhoneE164,
          serviceWindowExpiresAt,
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

      if (consent.kind === "revoked") {
        await store.suppressPendingWhatsAppDeliveries?.({
          clinicId: resolved.clinicId,
          contactId: resolved.contactId,
          now,
        });
        await store.markProcessed({
          consentReference: consent.reference,
          eventId: event.eventId,
          leaseToken,
          processedAt: now,
        });
        return "optedOut";
      }

      if (consent.consume) {
        await store.reactivatePendingWhatsAppDeliveries?.({
          clinicId: resolved.clinicId,
          consentReference: consent.reference,
          contactId: resolved.contactId,
          now,
        });
        await store.markProcessed({
          consentReference: consent.reference,
          eventId: event.eventId,
          leaseToken,
          processedAt: now,
        });
        return "processed";
      }

      if (event.text === null) {
        await store.markIgnored({
          eventId: event.eventId,
          leaseToken,
          processedAt: now,
          reason: "El mensaje interactivo no es una acción de consentimiento",
        });
        return "ignored";
      }
      const text = event.text;
      const persistedResponse = await store.getAssistantResponse({
        eventId: event.eventId,
        leaseToken,
      });
      const response =
        persistedResponse === null
          ? await input.assistant.processText({
              clinicId: resolved.clinicId,
              contactId: resolved.contactId,
              messageId: event.id,
              now,
              text,
            })
          : { text: persistedResponse };
      if (persistedResponse === null) {
        await store.saveAssistantResponse({
          eventId: event.eventId,
          leaseToken,
          responseText: response.text,
        });
      }
      if (response.text.trim() !== "") {
        await input.replySender.send({
          clinicId: resolved.clinicId,
          idempotencyKey: event.id,
          recipientBusinessScopedUserId: resolved.recipientBusinessScopedUserId,
          recipientPhoneE164: resolved.recipientPhoneE164,
          serviceWindowExpiresAt,
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
    },
  });
}

function notInboundReason(event: WhatsAppInboundEvent) {
  return event.direction === "outbound"
    ? "El evento Kapso es saliente"
    : "El evento Kapso no confirma una entrada del contacto";
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
