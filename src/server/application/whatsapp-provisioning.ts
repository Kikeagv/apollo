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
import type { WhatsAppProviderId } from "~/domain/whatsapp-runtime";

export type KapsoProvisioningEventStatus =
  "pending" | "processing" | "processed" | "rejected" | "ignored";

export type KapsoProvisioningEvent = {
  attempts: number;
  id: string;
  idempotencyKey: string;
  leaseToken: string | null;
  nextAttemptAt: Date | null;
  payload: KapsoPhoneNumberLifecycleEvent;
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
  getStep: (input: {
    clinicId: string;
    eventId: string;
    phoneNumberId: string;
    step: "phone-number-webhook" | "project-webhook";
  }) => Promise<KapsoProvisioningStepState | undefined>;
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
  ) => Promise<{ remoteId: string }>;
  ensureProjectWebhook: () => Promise<{ remoteId: string }>;
  getPhoneNumber: (
    phoneNumberId: string,
  ) => Promise<KapsoProvisioningPhoneNumber | undefined>;
};

export class KapsoProvisioningProviderError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
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
  constructor(message: string) {
    super(message);
    this.name = "KapsoProvisioningRetryError";
  }
}

export async function receiveKapsoWebhook(input: {
  eventName: string;
  idempotencyKey: string;
  payload: unknown;
  store: Pick<KapsoProvisioningStore, "enqueue" | "enqueueIgnored">;
}) {
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
      await processEvent(event, input.now, store, provider);
      await store.markProcessed({
        eventId: event.id,
        leaseToken: requireLeaseToken(event),
        processedAt: input.now,
      });
      result.processed += 1;
    } catch (error) {
      if (error instanceof KapsoProvisioningRetryError) {
        await store.scheduleRetry({
          eventId: event.id,
          leaseToken: requireLeaseToken(event),
          nextAttemptAt: nextAttemptAt(input.now, event.attempts),
          reason: error.message,
          retriedAt: input.now,
        });
        result.retried += 1;
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
    await processDeletedEvent(event, connection, lifecycleEvent, store);
    return;
  }

  await processCreatedEvent(
    event,
    connection,
    lifecycleEvent,
    now,
    store,
    provider,
  );
}

async function processDeletedEvent(
  eventRecord: KapsoProvisioningEvent,
  connection: KapsoProvisioningConnection,
  event: KapsoPhoneNumberLifecycleEvent,
  store: KapsoProvisioningStore,
) {
  if (connection.status === "disconnected") return;

  await store.updateConnection({
    clinicId: connection.clinicId,
    eventId: eventRecord.id,
    leaseToken: requireLeaseToken(eventRecord),
    metadata: withOperationalMetadata(connection.metadata, {
      nextAction: "Reconectar WhatsApp desde Configuración",
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
) {
  // Un evento creado que llega después de eliminado no puede resucitar la
  // Conexión: el operador debe volver a iniciar explícitamente la activación.
  if (connection.status === "disconnected" || connection.status === "ready") {
    return;
  }

  let metadata = connection.metadata;
  metadata = withOperationalMetadata(metadata, {
    nextAction: "Confirmar webhooks de WhatsApp",
    projectId: event.projectId,
    statusReason: "Número recibido; iniciando la provisión de Kapso",
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
      statusReason: "Webhooks de proyecto y número configurados",
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
  } catch (error) {
    if (error instanceof KapsoProvisioningRejectedError) {
      await store.updateConnection({
        clinicId: connection.clinicId,
        eventId: eventRecord.id,
        leaseToken: requireLeaseToken(eventRecord),
        metadata: withOperationalMetadata(metadata, {
          nextAction: "Revisar la asociación de Kapso",
          projectId: event.projectId,
          statusReason: error.message,
        }),
        phoneNumberE164: event.displayPhoneE164 ?? connection.phoneNumberE164,
        phoneNumberId: event.phoneNumberId,
        preserveDisconnected: true,
        status: "blocked",
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
        statusReason: toErrorMessage(error),
      }),
      phoneNumberE164: event.displayPhoneE164 ?? connection.phoneNumberE164,
      phoneNumberId: event.phoneNumberId,
      preserveDisconnected: true,
      status: retryable ? "degraded" : "blocked",
    });
    if (retryable) {
      throw new KapsoProvisioningRetryError(toErrorMessage(error));
    }
    throw error;
  }
}

async function ensureStep(input: {
  clinicId: string;
  event: KapsoProvisioningEvent;
  leaseToken: string;
  now: Date;
  providerCall: () => Promise<{ remoteId: string }>;
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
    const result = await input.providerCall();
    await input.store.saveStep({
      clinicId: input.clinicId,
      eventId: input.event.id,
      leaseToken: input.leaseToken,
      phoneNumberId: input.event.payload.phoneNumberId,
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

function nextAttemptAt(now: Date, attempts: number) {
  const delaySeconds = Math.min(300, 5 * 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + delaySeconds * 1000);
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
