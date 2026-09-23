import type { WhatsAppInboundMessage } from "~/domain/whatsapp-inbound";
import { parseKapsoInboundMessagePayload } from "~/server/whatsapp/kapso-inbound";
import {
  isKapsoDeliveryStatusEventName,
  parseKapsoDeliveryStatusPayload,
  type KapsoDeliveryStatusEvent,
} from "~/domain/whatsapp-delivery-events";
import { sanitizeWhatsAppOperationalText } from "~/domain/whatsapp-circuit-breaker";
import {
  KapsoLifecycleEventError,
  isKapsoPhoneNumberLifecycleEventName,
  isKapsoPhoneNumberWebhookEventName,
  type KapsoPhoneNumberLifecycleEvent,
  parseKapsoPhoneNumberLifecycleEvent,
} from "~/domain/whatsapp-kapso-provisioning";
import type {
  WhatsAppConnectionMetadata,
  WhatsAppConnectionStatus,
  WhatsAppConnectionType,
} from "~/domain/whatsapp-connection";
import type { WhatsAppCircuitBreakerState } from "~/domain/whatsapp-circuit-breaker";
import type { WhatsAppProviderId } from "~/domain/whatsapp-runtime";
import {
  provisionWhatsAppReadiness,
  WhatsAppReadinessRetryError,
  type WhatsAppReadinessProvider,
  type WhatsAppReadinessProvisioningStore,
} from "~/server/application/whatsapp-readiness";
import type { WhatsAppCircuitBreakerStore } from "./whatsapp-circuit-breaker";

export const KAPSO_PROVISIONING_MAX_ATTEMPTS = 3;
export const KAPSO_PROVISIONING_RETRY_DELAYS_MS = [10_000, 40_000] as const;

export type KapsoProvisioningEventStatus =
  "pending" | "processing" | "processed" | "rejected" | "ignored";

export type KapsoProvisioningEvent = {
  attempts: number;
  id: string;
  idempotencyKey: string;
  leaseRecovered: boolean;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  nextAttemptAt: Date | null;
  payload: KapsoPhoneNumberLifecycleEvent;
  receivedAt: Date;
  status: KapsoProvisioningEventStatus;
};

export type KapsoProvisioningConnection = {
  businessAccountId: string | null;
  clinicId: string;
  connectionType: WhatsAppConnectionType;
  customer: string;
  metadata: WhatsAppConnectionMetadata;
  phoneNumberE164: string | null;
  phoneNumberId: string | null;
  provider: WhatsAppProviderId;
  status: WhatsAppConnectionStatus;
};

export type KapsoProvisioningStepState = {
  remoteId?: string;
  status: "failed" | "succeeded";
};

export type KapsoProvisioningStore = {
  claimDueEvents: (input: {
    limit: number;
    now: Date;
  }) => Promise<KapsoProvisioningEvent[]>;
  enqueue: (input: {
    event: KapsoPhoneNumberLifecycleEvent;
    idempotencyKey: string;
  }) => Promise<{ accepted: boolean; eventId: string }>;
  enqueueIgnored: (input: {
    eventName: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }) => Promise<{ accepted: boolean; eventId: string }>;
  enqueueInbound?: (input: {
    idempotencyKey: string;
    message: WhatsAppInboundMessage;
  }) => Promise<{ accepted: boolean; eventId: string }>;
  enqueueDeliveryStatus?: (input: {
    event: KapsoDeliveryStatusEvent;
    idempotencyKey: string;
  }) => Promise<{ accepted: boolean; eventId: string }>;
  getStep: (input: {
    clinicId: string;
    eventId: string;
    phoneNumberId: string;
    step: "phone-number-webhook" | "project-webhook";
  }) => Promise<KapsoProvisioningStepState | undefined>;
  hasNewerCreatedEvent: (input: {
    event: KapsoPhoneNumberLifecycleEvent;
    eventId: string;
    receivedAt: Date;
  }) => Promise<boolean>;
  markProcessed: (input: {
    eventId: string;
    leaseToken: string;
    processedAt: Date;
  }) => Promise<void>;
  markRejected: (input: {
    eventId: string;
    leaseToken: string;
    reason: string;
    rejectedAt: Date;
  }) => Promise<void>;
  pauseForCircuit: (input: {
    eventId: string;
    leaseToken: string;
    pausedAt: Date;
    reason: string;
  }) => Promise<void>;
  resolveConnection: (input: {
    event: KapsoPhoneNumberLifecycleEvent;
  }) => Promise<
    | { connection: KapsoProvisioningConnection; kind: "matched" }
    | { kind: "crossed" | "unknown" }
  >;
  saveStep: (input: {
    clinicId: string;
    error?: string | null;
    eventId: string;
    leaseToken: string;
    phoneNumberId: string;
    projectId: string;
    remoteId?: string | null;
    status: "failed" | "succeeded";
    step: "phone-number-webhook" | "project-webhook";
    updatedAt: Date;
  }) => Promise<void>;
  scheduleRetry: (input: {
    eventId: string;
    leaseToken: string;
    nextAttemptAt: Date;
    reason: string;
    retriedAt: Date;
  }) => Promise<void>;
  updateConnection: (input: {
    businessAccountId?: string | null;
    clinicId: string;
    eventId: string;
    leaseToken: string;
    metadata?: WhatsAppConnectionMetadata;
    preserveDisconnected?: boolean;
    phoneNumberE164?: string | null;
    phoneNumberId?: string | null;
    status?: WhatsAppConnectionStatus;
  }) => Promise<void>;
  withWebhookProvisioningLock: <T>(input: {
    operation: () => Promise<T>;
    scope: string;
  }) => Promise<T>;
};

export type KapsoProvisioningPhoneNumber = {
  businessAccountId: string | null;
  customerId: string;
  displayPhoneE164: string | null;
  phoneNumberId: string;
};

export type KapsoProvisioningProvider = {
  ensurePhoneNumberWebhook: (
    phoneNumberId: string,
  ) => Promise<{ remoteId: string; wasPaused?: boolean }>;
  ensureProjectWebhook: () => Promise<{
    remoteId: string;
    wasPaused?: boolean;
  }>;
  getPhoneNumber: (
    phoneNumberId: string,
  ) => Promise<KapsoProvisioningPhoneNumber | undefined>;
  listPhoneNumbers?: (
    customerId: string,
  ) => Promise<KapsoProvisioningPhoneNumber[]>;
};

export type KapsoProvisioningReadiness = {
  circuitBreaker?: WhatsAppCircuitBreakerStore;
  provider: WhatsAppReadinessProvider;
  store: WhatsAppReadinessProvisioningStore;
};

export class KapsoProvisioningProviderError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(sanitizeWhatsAppOperationalText(message));
    this.name = "KapsoProvisioningProviderError";
    this.status = status;
  }
}

class KapsoProvisioningRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KapsoProvisioningRejectedError";
  }
}

class KapsoProvisioningRetryError extends Error {
  readonly cause: "provider-error" | "webhook-paused";
  readonly openImmediately: boolean;

  constructor(
    message: string,
    cause: "provider-error" | "webhook-paused" = "provider-error",
    openImmediately = false,
  ) {
    super(message);
    this.name = "KapsoProvisioningRetryError";
    this.cause = cause;
    this.openImmediately = openImmediately;
  }
}

export async function receiveKapsoWebhook(input: {
  eventName: string;
  idempotencyKey: string;
  payload: unknown;
  store: Pick<KapsoProvisioningStore, "enqueue" | "enqueueIgnored"> &
    Pick<KapsoProvisioningStore, "enqueueInbound"> &
    Pick<KapsoProvisioningStore, "enqueueDeliveryStatus">;
}) {
  if (input.eventName === "whatsapp.message.received") {
    const messages = parseKapsoInboundMessagePayload(
      input.payload,
      input.eventName,
    );
    if (input.store.enqueueInbound === undefined) {
      throw new Error("Falta el almacén de mensajes entrantes de Kapso");
    }
    return summarizeKapsoQueueResults(
      await enqueueKapsoInboundMessages({
        batchSize: messages.length,
        idempotencyKey: input.idempotencyKey,
        messages,
        enqueueInbound: input.store.enqueueInbound,
      }),
    );
  }
  if (input.eventName === "whatsapp.message.sent") {
    const messages = parseKapsoInboundMessagePayload(
      input.payload,
      input.eventName,
    );
    return enqueueKapsoSentMessages({
      enqueueDeliveryStatus: input.store.enqueueDeliveryStatus,
      enqueueIgnored: input.store.enqueueIgnored,
      enqueueInbound: input.store.enqueueInbound,
      idempotencyKey: input.idempotencyKey,
      messages,
    });
  }
  if (isKapsoDeliveryStatusEventName(input.eventName)) {
    const event = parseKapsoDeliveryStatusPayload(
      input.eventName,
      input.payload,
    );
    if (input.store.enqueueDeliveryStatus !== undefined) {
      return input.store.enqueueDeliveryStatus({
        event,
        idempotencyKey: input.idempotencyKey,
      });
    }
    return input.store.enqueueIgnored({
      eventName: input.eventName,
      idempotencyKey: input.idempotencyKey,
      payload: event.rawPayload,
    });
  }
  if (isKapsoPhoneNumberWebhookEventName(input.eventName)) {
    if (
      typeof input.payload !== "object" ||
      input.payload === null ||
      Array.isArray(input.payload)
    ) {
      throw new KapsoLifecycleEventError(
        "El payload de webhook Kapso es inválido",
      );
    }
    return input.store.enqueueIgnored({
      eventName: input.eventName,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload as Record<string, unknown>,
    });
  }
  if (!isKapsoPhoneNumberLifecycleEventName(input.eventName)) {
    parseKapsoPhoneNumberLifecycleEvent(input.eventName, input.payload);
    throw new KapsoLifecycleEventError("Evento de webhook Kapso no soportado");
  }
  const event = parseKapsoPhoneNumberLifecycleEvent(
    input.eventName,
    input.payload,
  );
  return input.store.enqueue({
    event,
    idempotencyKey: input.idempotencyKey,
  });
}

async function enqueueKapsoInboundMessages(input: {
  batchSize: number;
  enqueueInbound: NonNullable<KapsoProvisioningStore["enqueueInbound"]>;
  idempotencyKey: string;
  messages: WhatsAppInboundMessage[];
}) {
  return Promise.all(
    input.messages.map((message) =>
      input.enqueueInbound({
        idempotencyKey: idempotencyKeyForKapsoMessage({
          batchSize: input.batchSize,
          idempotencyKey: input.idempotencyKey,
          message,
        }),
        message,
      }),
    ),
  );
}

async function enqueueKapsoSentMessages(input: {
  enqueueDeliveryStatus: KapsoProvisioningStore["enqueueDeliveryStatus"];
  enqueueIgnored: KapsoProvisioningStore["enqueueIgnored"];
  enqueueInbound: KapsoProvisioningStore["enqueueInbound"];
  idempotencyKey: string;
  messages: WhatsAppInboundMessage[];
}) {
  const results = await Promise.all(
    input.messages.map(async (message) => {
      const idempotencyKey = idempotencyKeyForKapsoMessage({
        batchSize: input.messages.length,
        idempotencyKey: input.idempotencyKey,
        message,
      });
      if (
        message.origin === "business-app" ||
        message.origin === "history-sync"
      ) {
        if (input.enqueueInbound === undefined) {
          throw new Error("Falta el almacén de mensajes entrantes de Kapso");
        }
        const [result] = await enqueueKapsoInboundMessages({
          batchSize: input.messages.length,
          enqueueInbound: input.enqueueInbound,
          idempotencyKey: input.idempotencyKey,
          messages: [message],
        });
        if (result === undefined) {
          throw new Error("No se pudo encolar el mensaje de Business App");
        }
        return result;
      }

      const event = parseKapsoDeliveryStatusPayload(
        "whatsapp.message.sent",
        withDeliveryStatusIdentity(message),
      );
      if (input.enqueueDeliveryStatus !== undefined) {
        return input.enqueueDeliveryStatus({ event, idempotencyKey });
      }
      return input.enqueueIgnored({
        eventName: "whatsapp.message.sent",
        idempotencyKey,
        payload: event.rawPayload,
      });
    }),
  );
  return summarizeKapsoQueueResults(results);
}

function idempotencyKeyForKapsoMessage(input: {
  batchSize: number;
  idempotencyKey: string;
  message: WhatsAppInboundMessage;
}) {
  if (input.batchSize === 1) return input.idempotencyKey;
  return `${input.idempotencyKey}:${input.message.connectionReference}:${input.message.id}`;
}

function summarizeKapsoQueueResults(
  results: Array<{ accepted: boolean; eventId: string }>,
) {
  return {
    accepted: results.some((result) => result.accepted),
    eventId: results.length === 1 ? results[0]?.eventId : undefined,
    ...(results.length > 1
      ? { eventIds: results.map((result) => result.eventId) }
      : {}),
  };
}

function withDeliveryStatusIdentity(message: WhatsAppInboundMessage) {
  const rawPayload = message.rawPayload;
  const rawMessage = asRecord(rawPayload.message);
  return {
    ...rawPayload,
    message: {
      ...rawMessage,
      id: message.id,
      phone_number_id: message.connectionReference,
    },
    phone_number_id: message.connectionReference,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export type KapsoProvisioningWorkerResult = {
  claimed: number;
  processed: number;
  rejected: number;
  retried: number;
};

export async function runKapsoProvisioningWorker(
  input: { limit?: number; now: Date },
  store: KapsoProvisioningStore,
  provider: KapsoProvisioningProvider,
  readiness?: KapsoProvisioningReadiness,
  circuitBreaker?: WhatsAppCircuitBreakerStore,
): Promise<KapsoProvisioningWorkerResult> {
  const events = await store.claimDueEvents({
    limit: input.limit ?? 20,
    now: input.now,
  });
  const result: KapsoProvisioningWorkerResult = {
    claimed: events.length,
    processed: 0,
    rejected: 0,
    retried: 0,
  };

  for (const event of events) {
    try {
      if (
        event.leaseRecovered &&
        event.attempts >= KAPSO_PROVISIONING_MAX_ATTEMPTS
      ) {
        const clinicId =
          circuitBreaker === undefined
            ? null
            : await clinicIdForProvisioningEvent(event, store);
        const failure = await recordProvisioningFailure({
          cause: "provider-error",
          circuitBreaker,
          clinicId,
          now: input.now,
          reason:
            "Se recuperó un lease de provisioning vencido en el tercer intento",
        });
        if (failure?.opened || failure?.state.status === "open") {
          await store.pauseForCircuit({
            eventId: event.id,
            leaseToken: requireLeaseToken(event),
            pausedAt: input.now,
            reason:
              "Se recuperó un lease de provisioning vencido en el tercer intento",
          });
          result.retried += 1;
        } else {
          await store.markRejected({
            eventId: event.id,
            leaseToken: requireLeaseToken(event),
            reason:
              "El lease de provisioning venció después del máximo de intentos",
            rejectedAt: input.now,
          });
          result.rejected += 1;
        }
        continue;
      }
      await processEvent(event, input.now, store, provider, readiness);
      await store.markProcessed({
        eventId: event.id,
        leaseToken: requireLeaseToken(event),
        processedAt: input.now,
      });
      result.processed += 1;
    } catch (error) {
      if (
        error instanceof KapsoProvisioningRetryError ||
        error instanceof WhatsAppReadinessRetryError
      ) {
        const clinicId =
          circuitBreaker === undefined
            ? null
            : await clinicIdForProvisioningEvent(event, store);
        const failure = await recordProvisioningFailure({
          circuitBreaker,
          clinicId,
          cause:
            error instanceof KapsoProvisioningRetryError
              ? error.cause
              : "provider-error",
          openImmediately:
            error instanceof KapsoProvisioningRetryError &&
            error.openImmediately,
          now: input.now,
          reason: error.message,
        });
        if (failure?.opened || failure?.state.status === "open") {
          await store.pauseForCircuit({
            eventId: event.id,
            leaseToken: requireLeaseToken(event),
            pausedAt: input.now,
            reason: error.message,
          });
          result.retried += 1;
          continue;
        }
        if (event.attempts < KAPSO_PROVISIONING_MAX_ATTEMPTS) {
          await store.scheduleRetry({
            eventId: event.id,
            leaseToken: requireLeaseToken(event),
            nextAttemptAt: nextKapsoProvisioningAttemptAt(
              input.now,
              event.attempts,
            ),
            reason: error.message,
            retriedAt: input.now,
          });
          result.retried += 1;
          continue;
        }
        await store.markRejected({
          eventId: event.id,
          leaseToken: requireLeaseToken(event),
          reason: error.message,
          rejectedAt: input.now,
        });
        result.rejected += 1;
        continue;
      }

      const reason = toErrorMessage(error);
      await store.markRejected({
        eventId: event.id,
        leaseToken: requireLeaseToken(event),
        reason,
        rejectedAt: input.now,
      });
      result.rejected += 1;
    }
  }

  return result;
}

async function processEvent(
  event: KapsoProvisioningEvent,
  now: Date,
  store: KapsoProvisioningStore,
  provider: KapsoProvisioningProvider,
  readiness?: KapsoProvisioningReadiness,
) {
  return store.withWebhookProvisioningLock({
    operation: () =>
      processEventUnderLifecycleLock(event, now, store, provider, readiness),
    scope: `lifecycle:${event.payload.phoneNumberId}`,
  });
}

async function processEventUnderLifecycleLock(
  event: KapsoProvisioningEvent,
  now: Date,
  store: KapsoProvisioningStore,
  provider: KapsoProvisioningProvider,
  readiness?: KapsoProvisioningReadiness,
) {
  const lifecycleEvent = event.payload;
  const resolved = await store.resolveConnection({ event: lifecycleEvent });
  if (resolved.kind !== "matched") {
    throw new KapsoProvisioningRejectedError(
      resolved.kind === "unknown"
        ? "El número de Kapso no está asociado a ninguna Clínica"
        : "La identidad de Kapso cruza la asociación de otra Clínica",
    );
  }
  const connection = resolved.connection;

  if (lifecycleEvent.eventName === "whatsapp.phone_number.deleted") {
    await processDeletedEvent(
      event,
      connection,
      lifecycleEvent,
      store,
      provider,
    );
    return;
  }

  const shouldRunReadiness = await processCreatedEvent(
    event,
    connection,
    lifecycleEvent,
    now,
    store,
    provider,
    readiness,
  );
  if (readiness !== undefined && shouldRunReadiness) {
    await provisionWhatsAppReadiness(
      {
        clinicId: connection.clinicId,
        eventId: event.id,
        leaseToken: requireLeaseToken(event),
        now,
        phoneNumberId: lifecycleEvent.phoneNumberId,
        projectId: lifecycleEvent.projectId,
      },
      readiness,
    );
  }
}

async function processDeletedEvent(
  eventRecord: KapsoProvisioningEvent,
  connection: KapsoProvisioningConnection,
  event: KapsoPhoneNumberLifecycleEvent,
  store: KapsoProvisioningStore,
  provider: KapsoProvisioningProvider,
) {
  if (connection.status === "disconnected") return;

  if (
    await store.hasNewerCreatedEvent({
      event,
      eventId: eventRecord.id,
      receivedAt: eventRecord.receivedAt,
    })
  ) {
    return;
  }

  let phoneNumber: KapsoProvisioningPhoneNumber | undefined;
  try {
    phoneNumber = await provider.getPhoneNumber(event.phoneNumberId);
  } catch (error) {
    if (isRetryableProviderError(error)) {
      throw new KapsoProvisioningRetryError(toErrorMessage(error));
    }
    throw error;
  }
  if (phoneNumber !== undefined) {
    // Kapso puede entregar un delete atrasado después de que el mismo número
    // haya sido reconectado. La lectura actual del recurso remoto es la única
    // señal disponible para evitar desconectar esa nueva generación.
    assertPhoneNumberMatchesEvent(phoneNumber, event);
    return;
  }

  await store.updateConnection({
    clinicId: connection.clinicId,
    eventId: eventRecord.id,
    leaseToken: requireLeaseToken(eventRecord),
    metadata: withOperationalMetadata(connection.metadata, {
      nextAction: "Reconectar WhatsApp desde Configuración",
      provisioningEventId: eventRecord.id,
      statusReason: "Kapso notificó que el número de WhatsApp fue eliminado",
    }),
    phoneNumberE164: connection.phoneNumberE164,
    phoneNumberId: event.phoneNumberId,
    status: "disconnected",
  });
}

async function processCreatedEvent(
  eventRecord: KapsoProvisioningEvent,
  connection: KapsoProvisioningConnection,
  event: KapsoPhoneNumberLifecycleEvent,
  now: Date,
  store: KapsoProvisioningStore,
  provider: KapsoProvisioningProvider,
  readiness?: KapsoProvisioningReadiness,
) {
  // Un evento creado que llega después de eliminado no puede resucitar la
  // Conexión: el operador debe volver a iniciar explícitamente la activación.
  if (connection.status === "disconnected" || connection.status === "ready") {
    return false;
  }

  let metadata = connection.metadata;
  let failedGate: "number" | "webhooks" = "number";
  metadata = withOperationalMetadata(metadata, {
    nextAction: "Confirmar webhooks de WhatsApp",
    projectId: event.projectId,
    provisioningEventId: eventRecord.id,
    statusReason: "Número recibido; iniciando la provisión de Kapso",
    webhookStatus: "pending",
  });

  await store.updateConnection({
    businessAccountId: connection.businessAccountId,
    clinicId: connection.clinicId,
    eventId: eventRecord.id,
    leaseToken: requireLeaseToken(eventRecord),
    metadata,
    preserveDisconnected: true,
    phoneNumberE164: event.displayPhoneE164 ?? connection.phoneNumberE164,
    phoneNumberId: event.phoneNumberId,
    status: "provisioning",
  });

  let phoneNumber: KapsoProvisioningPhoneNumber | undefined;
  try {
    phoneNumber = await provider.getPhoneNumber(event.phoneNumberId);
    if (phoneNumber === undefined) {
      throw new KapsoProvisioningRejectedError(
        "Kapso ya no encuentra el número recibido",
      );
    }
    assertPhoneNumberMatchesEvent(phoneNumber, event);

    const businessAccountId =
      phoneNumber.businessAccountId ?? event.businessAccountId;
    const displayPhoneE164 =
      phoneNumber.displayPhoneE164 ?? event.displayPhoneE164;
    metadata = withOperationalMetadata(metadata, {
      businessAccountId,
      displayPhoneE164,
      nextAction: "Confirmar webhooks de WhatsApp",
      projectId: event.projectId,
      provisioningEventId: eventRecord.id,
      statusReason: "Número asociado; configurando webhooks de Kapso",
    });
    await store.updateConnection({
      businessAccountId,
      clinicId: connection.clinicId,
      eventId: eventRecord.id,
      leaseToken: requireLeaseToken(eventRecord),
      metadata,
      preserveDisconnected: true,
      phoneNumberE164: displayPhoneE164,
      phoneNumberId: event.phoneNumberId,
      status: "provisioning",
    });

    failedGate = "webhooks";
    await ensureStep({
      clinicId: connection.clinicId,
      event: eventRecord,
      leaseToken: requireLeaseToken(eventRecord),
      now,
      providerCall: () => provider.ensureProjectWebhook(),
      store,
      step: "project-webhook",
    });
    await ensureStep({
      clinicId: connection.clinicId,
      event: eventRecord,
      leaseToken: requireLeaseToken(eventRecord),
      now,
      providerCall: () =>
        provider.ensurePhoneNumberWebhook(event.phoneNumberId),
      store,
      step: "phone-number-webhook",
    });

    metadata = withOperationalMetadata(metadata, {
      businessAccountId,
      displayPhoneE164,
      nextAction: "Sincronizar plantillas, billing y ejecutar una prueba E2E",
      projectId: event.projectId,
      provisioningEventId: eventRecord.id,
      statusReason: "Webhooks de proyecto y número configurados",
      webhookStatus: "ready",
    });
    await store.updateConnection({
      businessAccountId,
      clinicId: connection.clinicId,
      eventId: eventRecord.id,
      leaseToken: requireLeaseToken(eventRecord),
      metadata,
      preserveDisconnected: true,
      phoneNumberE164: displayPhoneE164,
      phoneNumberId: event.phoneNumberId,
      status: "provisioning",
    });
    return true;
  } catch (error) {
    const gateCode =
      error instanceof KapsoProvisioningRejectedError ? "number" : failedGate;
    if (error instanceof KapsoProvisioningRejectedError) {
      await store.updateConnection({
        clinicId: connection.clinicId,
        eventId: eventRecord.id,
        leaseToken: requireLeaseToken(eventRecord),
        metadata: withOperationalMetadata(metadata, {
          nextAction: "Revisar la asociación de Kapso",
          projectId: event.projectId,
          provisioningEventId: eventRecord.id,
          statusReason: error.message,
          ...(gateCode === "webhooks" ? { webhookStatus: "failed" } : {}),
        }),
        phoneNumberE164: event.displayPhoneE164 ?? connection.phoneNumberE164,
        phoneNumberId: event.phoneNumberId,
        preserveDisconnected: true,
        status: "blocked",
      });
      await openProvisioningAlert(readiness, {
        clinicId: connection.clinicId,
        eventId: eventRecord.id,
        gateCode,
        leaseToken: requireLeaseToken(eventRecord),
        nextAction: "Revisar la asociación de Kapso",
        now,
        reason: error.message,
      });
      throw error;
    }

    const retryable = isRetryableProviderError(error);
    await store.updateConnection({
      clinicId: connection.clinicId,
      eventId: eventRecord.id,
      leaseToken: requireLeaseToken(eventRecord),
      metadata: withOperationalMetadata(metadata, {
        nextAction: retryable
          ? "Reintentar la provisión de Kapso"
          : "Revisar la configuración de Kapso",
        projectId: event.projectId,
        provisioningEventId: eventRecord.id,
        statusReason: toErrorMessage(error),
        ...(gateCode === "webhooks" ? { webhookStatus: "failed" } : {}),
      }),
      phoneNumberE164: event.displayPhoneE164 ?? connection.phoneNumberE164,
      phoneNumberId: event.phoneNumberId,
      preserveDisconnected: true,
      status: retryable ? "degraded" : "blocked",
    });
    await openProvisioningAlert(readiness, {
      clinicId: connection.clinicId,
      eventId: eventRecord.id,
      gateCode,
      leaseToken: requireLeaseToken(eventRecord),
      nextAction: retryable
        ? "Reintentar la provisión de Kapso"
        : "Revisar la configuración de Kapso",
      now,
      reason: toErrorMessage(error),
    });
    if (retryable) {
      throw new KapsoProvisioningRetryError(
        toErrorMessage(error),
        gateCode === "webhooks" ? "webhook-paused" : "provider-error",
      );
    }
    throw error;
  }
}

async function openProvisioningAlert(
  readiness: KapsoProvisioningReadiness | undefined,
  input: {
    clinicId: string;
    eventId: string;
    gateCode: "number" | "webhooks";
    leaseToken: string;
    nextAction: string;
    now: Date;
    reason: string;
  },
) {
  if (readiness === undefined) return;
  await readiness.store.openAlert({
    access: "provisioning-worker",
    ...input,
  });
}

async function ensureStep(input: {
  clinicId: string;
  event: KapsoProvisioningEvent;
  leaseToken: string;
  now: Date;
  providerCall: () => Promise<{ remoteId: string; wasPaused?: boolean }>;
  step: "phone-number-webhook" | "project-webhook";
  store: KapsoProvisioningStore;
}) {
  const existing = await input.store.getStep({
    clinicId: input.clinicId,
    eventId: input.event.id,
    phoneNumberId: input.event.payload.phoneNumberId,
    step: input.step,
  });
  if (existing?.status === "succeeded") return;

  try {
    const result = await input.store.withWebhookProvisioningLock({
      operation: input.providerCall,
      scope:
        input.step === "project-webhook"
          ? "project"
          : `phone:${input.event.payload.phoneNumberId}`,
    });
    if (result.wasPaused === true) {
      throw new KapsoProvisioningRetryError(
        "Kapso pausó el webhook; se requiere reactivación manual",
        "webhook-paused",
        true,
      );
    }
    await input.store.saveStep({
      clinicId: input.clinicId,
      eventId: input.event.id,
      leaseToken: input.leaseToken,
      phoneNumberId: input.event.payload.phoneNumberId,
      projectId: input.event.payload.projectId,
      remoteId: result.remoteId,
      status: "succeeded",
      step: input.step,
      updatedAt: input.now,
    });
  } catch (error) {
    await input.store.saveStep({
      clinicId: input.clinicId,
      error: toErrorMessage(error),
      eventId: input.event.id,
      leaseToken: input.leaseToken,
      phoneNumberId: input.event.payload.phoneNumberId,
      projectId: input.event.payload.projectId,
      status: "failed",
      step: input.step,
      updatedAt: input.now,
    });
    throw error;
  }
}

function assertPhoneNumberMatchesEvent(
  phoneNumber: KapsoProvisioningPhoneNumber,
  event: KapsoPhoneNumberLifecycleEvent,
) {
  if (
    phoneNumber.phoneNumberId !== event.phoneNumberId ||
    phoneNumber.customerId !== event.customerId ||
    (event.businessAccountId !== null &&
      phoneNumber.businessAccountId !== null &&
      phoneNumber.businessAccountId !== event.businessAccountId)
  ) {
    throw new KapsoProvisioningRejectedError(
      "La respuesta de Kapso no coincide con la asociación recibida",
    );
  }
}

function withOperationalMetadata(
  current: WhatsAppConnectionMetadata,
  additions: Record<string, string | null | undefined>,
) {
  const definedAdditions: WhatsAppConnectionMetadata = {};
  for (const [key, value] of Object.entries(additions)) {
    if (value !== undefined) definedAdditions[key] = value;
  }
  return {
    ...current,
    ...definedAdditions,
  };
}

function isRetryableProviderError(error: unknown) {
  if (error instanceof KapsoProvisioningProviderError) {
    return (
      error.status === 0 ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500
    );
  }
  if (error instanceof Error) {
    return (
      error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      error.message.toLowerCase().includes("timeout")
    );
  }
  return true;
}

async function clinicIdForProvisioningEvent(
  event: KapsoProvisioningEvent,
  store: KapsoProvisioningStore,
) {
  const resolved = await store.resolveConnection({ event: event.payload });
  return resolved.kind === "matched" ? resolved.connection.clinicId : null;
}

async function recordProvisioningFailure(input: {
  cause: "provider-error" | "webhook-paused";
  circuitBreaker?: WhatsAppCircuitBreakerStore;
  clinicId: string | null;
  now: Date;
  openImmediately?: boolean;
  reason: string;
}): Promise<
  { opened: boolean; state: WhatsAppCircuitBreakerState } | undefined
> {
  if (input.circuitBreaker === undefined || input.clinicId === null) {
    return undefined;
  }
  if (input.openImmediately) {
    const state = await input.circuitBreaker.open({
      actorKind: "worker",
      cause: input.cause,
      clinicId: input.clinicId,
      now: input.now,
      reason: input.reason,
      workerKind: "provisioning",
    });
    return { opened: state.status === "open", state };
  }
  return input.circuitBreaker.recordFailure({
    cause: input.cause,
    clinicId: input.clinicId,
    now: input.now,
    reason: input.reason,
    workerKind: "provisioning",
  });
}

export function nextKapsoProvisioningAttemptAt(now: Date, attempts: number) {
  const delay =
    KAPSO_PROVISIONING_RETRY_DELAYS_MS[attempts - 1] ??
    KAPSO_PROVISIONING_RETRY_DELAYS_MS.at(-1)!;
  return new Date(now.valueOf() + delay);
}

function requireLeaseToken(event: KapsoProvisioningEvent) {
  if (event.leaseToken === null) {
    throw new Error("El evento Kapso no tiene un lease activo");
  }
  return event.leaseToken;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Error desconocido de Kapso";
}
