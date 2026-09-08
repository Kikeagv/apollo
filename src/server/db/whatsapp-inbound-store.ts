import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import {
  hasWhatsAppIdentityChanged,
  resolveWhatsAppIdentity,
  type WhatsAppIdentityRecord,
} from "~/domain/whatsapp-identity";
import type { KapsoInboundMessage } from "~/domain/whatsapp-inbound";
import {
  inWhatsAppInboundWorkerTransaction,
  inWhatsAppWebhookIngressTransaction,
} from "~/server/db/clinic-context";
import type { db } from "~/server/db";
import {
  clinics,
  contacts,
  whatsappConnections,
  whatsappConversationLocks,
  whatsappIdentities,
  whatsappInboundMessages,
  whatsappInboundReplies,
} from "~/server/db/schema";
import type {
  WhatsAppInboundEvent,
  WhatsAppInboundEventStatus,
  WhatsAppInboundReplySender,
  WhatsAppInboundResolution,
  WhatsAppInboundStore,
} from "~/server/application/whatsapp-inbound";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const INBOUND_LEASE_MS = 5 * 60_000;
const MAX_INBOUND_ATTEMPTS = 5;
const RETRY_DELAY_MS = 10_000;
const CONVERSATION_LOCK_WAIT_MS = 30_000;

export type WhatsAppInboundPersistenceStore = WhatsAppInboundStore & {
  enqueueInbound(input: {
    idempotencyKey: string;
    message: KapsoInboundMessage;
  }): Promise<{ accepted: boolean; eventId: string }>;
  enqueueReply(
    input: Parameters<WhatsAppInboundReplySender["send"]>[0],
  ): Promise<void>;
};

/** Persistencia del webhook y del worker inbound con contextos RLS separados. */
export const drizzleWhatsAppInboundStore: WhatsAppInboundPersistenceStore = {
  async enqueueInbound({ idempotencyKey, message }) {
    return inWhatsAppWebhookIngressTransaction(async (transaction) => {
      const [inserted] = await transaction
        .insert(whatsappInboundMessages)
        .values({
          batchSequence: message.batchSequence,
          businessScopedUserId: message.businessScopedUserId,
          conversationId: message.conversationId,
          customerId: message.customerId,
          direction: message.direction,
          eventName: message.eventName,
          fromWaId: message.fromWaId,
          idempotencyKey,
          messageId: message.id,
          messageTimestamp: message.messageTimestamp,
          origin: message.origin,
          parentBusinessScopedUserId: message.parentBusinessScopedUserId,
          phoneE164: message.phoneE164,
          phoneNumberId: message.phoneNumberId,
          rawPayload: message.rawPayload,
          status: "pending",
          text: message.text,
          type: message.type,
          username: message.username,
        })
        .onConflictDoNothing()
        .returning({ id: whatsappInboundMessages.id });
      if (inserted !== undefined) {
        return { accepted: true, eventId: inserted.id };
      }

      const existing = await transaction
        .select({ id: whatsappInboundMessages.id })
        .from(whatsappInboundMessages)
        .where(
          or(
            eq(whatsappInboundMessages.idempotencyKey, idempotencyKey),
            and(
              eq(whatsappInboundMessages.phoneNumberId, message.phoneNumberId),
              eq(whatsappInboundMessages.messageId, message.id),
            ),
          ),
        )
        .limit(1);
      return {
        accepted: false,
        eventId: existing[0]?.id ?? "duplicate",
      };
    });
  },

  async claimDueMessages({ limit, now }) {
    return inWhatsAppInboundWorkerTransaction(async (transaction) => {
      const candidates = await transaction
        .select()
        .from(whatsappInboundMessages)
        .where(dueMessageCondition(now))
        .orderBy(
          sql`${whatsappInboundMessages.batchSequence} ASC NULLS LAST`,
          asc(whatsappInboundMessages.receivedAt),
        )
        .limit(limit);
      const claimed: WhatsAppInboundEvent[] = [];

      for (const candidate of candidates) {
        const leaseToken = randomUUID();
        const [updated] = await transaction
          .update(whatsappInboundMessages)
          .set({
            attempts: candidate.attempts + 1,
            lastError: null,
            leaseExpiresAt: new Date(now.valueOf() + INBOUND_LEASE_MS),
            leaseToken,
            nextAttemptAt: null,
            status: "processing",
          })
          .where(
            and(
              eq(whatsappInboundMessages.id, candidate.id),
              dueMessageCondition(now),
            ),
          )
          .returning();
        if (updated !== undefined) claimed.push(toInboundEvent(updated));
      }
      return claimed;
    });
  },

  async getAssistantResponse({ eventId, leaseToken }) {
    return inWhatsAppInboundWorkerTransaction(async (transaction) => {
      const message = await transaction.query.whatsappInboundMessages.findFirst(
        {
          columns: { assistantResponseText: true },
          where: and(
            eq(whatsappInboundMessages.id, eventId),
            eq(whatsappInboundMessages.leaseToken, leaseToken),
            eq(whatsappInboundMessages.status, "processing"),
          ),
        },
      );
      return message?.assistantResponseText ?? null;
    });
  },

  async resolveMessage({ message }) {
    return inWhatsAppInboundWorkerTransaction(async (transaction) => {
      const connection = await transaction.query.whatsappConnections.findFirst({
        where: eq(whatsappConnections.phoneNumberId, message.phoneNumberId),
      });
      if (connection?.provider !== "kapso") {
        return {
          kind: "unknown-connection",
          reason:
            "El phone_number_id de WhatsApp no está asociado a una Clínica",
        } satisfies WhatsAppInboundResolution;
      }
      if (
        message.customerId === null ||
        connection.customer !== message.customerId
      ) {
        return {
          kind: "customer-mismatch",
          reason:
            "El customer de Kapso no coincide con la Conexión de la Clínica",
        } satisfies WhatsAppInboundResolution;
      }
      if (connection.status !== "ready") {
        return {
          kind: "connection-not-ready",
          reason:
            "La Conexión de WhatsApp no está lista para procesar mensajes",
        } satisfies WhatsAppInboundResolution;
      }

      const clinic = await configureWorkerClinic(
        transaction,
        connection.clinicId,
      );
      if (clinic.subscriptionStatus !== "active") {
        return {
          kind: "connection-not-ready",
          reason:
            "La Clínica no está activa para procesar mensajes de WhatsApp",
        } satisfies WhatsAppInboundResolution;
      }
      const identityRows = await transaction
        .select()
        .from(whatsappIdentities)
        .where(
          and(
            eq(whatsappIdentities.clinicId, connection.clinicId),
            eq(whatsappIdentities.phoneNumberId, message.phoneNumberId),
            eq(whatsappIdentities.status, "active"),
          ),
        );
      const identities = identityRows.map(toIdentityRecord);
      const resolved = resolveWhatsAppIdentity({
        businessScopedUserId: message.businessScopedUserId,
        identities,
        phoneE164: message.phoneE164,
        phoneNumberId: message.phoneNumberId,
      });

      if (resolved.kind === "conflict") {
        await insertIdentitySnapshot(transaction, {
          clinicId: connection.clinicId,
          message,
          status: "conflict",
        });
        await updateInboundResolution(transaction, message.eventId, {
          clinicId: connection.clinicId,
        });
        return resolved;
      }
      if (resolved.kind === "unresolved") {
        if (message.phoneE164 !== null) {
          const contact = await transaction.query.contacts.findFirst({
            columns: { id: true },
            where: and(
              eq(contacts.clinicId, connection.clinicId),
              eq(contacts.phoneE164, message.phoneE164),
            ),
          });
          if (contact !== undefined) {
            const identityId = await preserveIdentitySnapshot(transaction, {
              clinicId: connection.clinicId,
              existing: identities,
              message,
              contactId: contact.id,
            });
            await updateInboundResolution(transaction, message.eventId, {
              clinicId: connection.clinicId,
              contactId: contact.id,
              identityId,
              serviceWindowExpiresAt: serviceWindowExpiresAt(message),
            });
            return {
              clinicId: connection.clinicId,
              contactId: contact.id,
              identityId,
              kind: "matched",
              recipientBusinessScopedUserId: message.businessScopedUserId,
              recipientPhoneE164: message.phoneE164,
            } satisfies WhatsAppInboundResolution;
          }
        }
        await insertIdentitySnapshot(transaction, {
          clinicId: connection.clinicId,
          message,
          status: "unresolved",
        });
        await updateInboundResolution(transaction, message.eventId, {
          clinicId: connection.clinicId,
        });
        return {
          kind: "unknown-contact",
          reason: resolved.reason,
        } satisfies WhatsAppInboundResolution;
      }

      const identityId = await preserveIdentitySnapshot(transaction, {
        clinicId: connection.clinicId,
        existing: identities,
        message,
        contactId: resolved.identity.contactId,
      });
      await updateInboundResolution(transaction, message.eventId, {
        clinicId: connection.clinicId,
        contactId: resolved.identity.contactId,
        identityId,
        serviceWindowExpiresAt: serviceWindowExpiresAt(message),
      });
      return {
        clinicId: connection.clinicId,
        contactId: resolved.identity.contactId,
        identityId,
        kind: "matched",
        recipientBusinessScopedUserId:
          message.businessScopedUserId ??
          resolved.identity.businessScopedUserId,
        recipientPhoneE164: message.phoneE164 ?? resolved.identity.phoneE164,
      } satisfies WhatsAppInboundResolution;
    });
  },

  async markAwaitingConsent({
    consentReference,
    eventId,
    leaseToken,
    processedAt,
  }) {
    await finishClaim({
      consentReference: consentReference ?? null,
      eventId,
      leaseToken,
      processedAt,
      status: "awaiting-consent",
    });
  },

  async markConflict({ eventId, leaseToken, processedAt, reason }) {
    await finishClaim({
      eventId,
      lastError: reason,
      leaseToken,
      processedAt,
      status: "conflict",
    });
  },

  async markIgnored({ eventId, leaseToken, processedAt, reason }) {
    await finishClaim({
      eventId,
      lastError: reason,
      leaseToken,
      processedAt,
      status: "ignored",
    });
  },

  async markProcessed({ consentReference, eventId, leaseToken, processedAt }) {
    await finishClaim({
      consentReference,
      eventId,
      leaseToken,
      processedAt,
      status: "processed",
    });
  },

  async markRejected({ eventId, leaseToken, processedAt, reason }) {
    await finishClaim({
      eventId,
      lastError: reason,
      leaseToken,
      processedAt,
      status: "rejected",
    });
  },

  async enqueueReply(input) {
    await inWhatsAppInboundWorkerTransaction(async (transaction) => {
      await transaction
        .insert(whatsappInboundReplies)
        .values({
          buttonLabel: input.buttonLabel,
          clinicId: input.clinicId,
          idempotencyKey: input.idempotencyKey,
          recipientBusinessScopedUserId: input.recipientBusinessScopedUserId,
          recipientPhoneE164: input.recipientPhoneE164,
          text: input.text,
          status: "pending",
        })
        .onConflictDoNothing({
          target: [
            whatsappInboundReplies.clinicId,
            whatsappInboundReplies.idempotencyKey,
          ],
        });
    });
  },

  async saveAssistantResponse({ eventId, leaseToken, responseText }) {
    await inWhatsAppInboundWorkerTransaction(async (transaction) => {
      await transaction
        .update(whatsappInboundMessages)
        .set({ assistantResponseText: responseText })
        .where(
          and(
            eq(whatsappInboundMessages.id, eventId),
            eq(whatsappInboundMessages.leaseToken, leaseToken),
            eq(whatsappInboundMessages.status, "processing"),
          ),
        );
    });
  },

  async scheduleRetry({ eventId, leaseToken, now, reason }) {
    await inWhatsAppInboundWorkerTransaction(async (transaction) => {
      const current = await transaction.query.whatsappInboundMessages.findFirst(
        {
          columns: { attempts: true },
          where: and(
            eq(whatsappInboundMessages.id, eventId),
            eq(whatsappInboundMessages.leaseToken, leaseToken),
            eq(whatsappInboundMessages.status, "processing"),
          ),
        },
      );
      if (current === undefined) return;
      const exhausted = current.attempts >= MAX_INBOUND_ATTEMPTS;
      await transaction
        .update(whatsappInboundMessages)
        .set({
          lastError: reason.slice(0, 1_000),
          leaseExpiresAt: null,
          leaseToken: null,
          nextAttemptAt: exhausted
            ? null
            : new Date(now.valueOf() + RETRY_DELAY_MS),
          processedAt: exhausted ? now : null,
          status: exhausted ? "rejected" : "pending",
        })
        .where(
          and(
            eq(whatsappInboundMessages.id, eventId),
            eq(whatsappInboundMessages.leaseToken, leaseToken),
            eq(whatsappInboundMessages.status, "processing"),
          ),
        );
    });
  },

  async withConversationLock({ clinicId, conversationId, operation }) {
    if (conversationId === null) return operation();

    const ownerToken = randomUUID();
    const deadline = Date.now() + CONVERSATION_LOCK_WAIT_MS;
    let acquired = false;
    while (!acquired) {
      acquired = await tryAcquireConversationLock({
        clinicId,
        conversationId,
        ownerToken,
      });
      if (acquired) break;
      if (Date.now() >= deadline) {
        throw new Error("La conversación de WhatsApp está siendo procesada");
      }
      await waitForConversationLock();
    }

    try {
      return await operation();
    } finally {
      await inWhatsAppInboundWorkerTransaction(async (transaction) => {
        await transaction
          .delete(whatsappConversationLocks)
          .where(
            and(
              eq(whatsappConversationLocks.clinicId, clinicId),
              eq(whatsappConversationLocks.conversationId, conversationId),
              eq(whatsappConversationLocks.ownerToken, ownerToken),
            ),
          );
      });
    }
  },
};

async function tryAcquireConversationLock(input: {
  clinicId: string;
  conversationId: string;
  ownerToken: string;
}) {
  return inWhatsAppInboundWorkerTransaction(async (transaction) => {
    const now = new Date();
    const leaseExpiresAt = new Date(now.valueOf() + INBOUND_LEASE_MS);
    const [inserted] = await transaction
      .insert(whatsappConversationLocks)
      .values({
        clinicId: input.clinicId,
        conversationId: input.conversationId,
        leaseExpiresAt,
        ownerToken: input.ownerToken,
      })
      .onConflictDoNothing({
        target: [
          whatsappConversationLocks.clinicId,
          whatsappConversationLocks.conversationId,
        ],
      })
      .returning({ id: whatsappConversationLocks.id });
    if (inserted !== undefined) return true;

    const [reclaimed] = await transaction
      .update(whatsappConversationLocks)
      .set({ leaseExpiresAt, ownerToken: input.ownerToken })
      .where(
        and(
          eq(whatsappConversationLocks.clinicId, input.clinicId),
          eq(whatsappConversationLocks.conversationId, input.conversationId),
          lte(whatsappConversationLocks.leaseExpiresAt, now),
        ),
      )
      .returning({ id: whatsappConversationLocks.id });
    return reclaimed !== undefined;
  });
}

function waitForConversationLock() {
  return new Promise<void>((resolve) => setTimeout(resolve, 100));
}

async function finishClaim(input: {
  consentReference?: string | null;
  eventId: string;
  lastError?: string | null;
  leaseToken: string;
  processedAt: Date;
  status: Exclude<WhatsAppInboundEventStatus, "pending" | "processing">;
}) {
  await inWhatsAppInboundWorkerTransaction(async (transaction) => {
    await transaction
      .update(whatsappInboundMessages)
      .set({
        ...(input.consentReference === undefined
          ? {}
          : { consentReference: input.consentReference }),
        lastError:
          input.lastError == null ? null : input.lastError.slice(0, 1_000),
        leaseExpiresAt: null,
        leaseToken: null,
        nextAttemptAt: null,
        processedAt: input.processedAt,
        status: input.status,
      })
      .where(
        and(
          eq(whatsappInboundMessages.id, input.eventId),
          eq(whatsappInboundMessages.leaseToken, input.leaseToken),
          eq(whatsappInboundMessages.status, "processing"),
        ),
      );
  });
}

function serviceWindowExpiresAt(message: WhatsAppInboundEvent) {
  return new Date(
    (message.messageTimestamp ?? message.receivedAt).valueOf() +
      24 * 60 * 60_000,
  );
}

function dueMessageCondition(now: Date) {
  return or(
    and(
      eq(whatsappInboundMessages.status, "pending"),
      or(
        isNull(whatsappInboundMessages.nextAttemptAt),
        lte(whatsappInboundMessages.nextAttemptAt, now),
      ),
    ),
    and(
      eq(whatsappInboundMessages.status, "processing"),
      lte(whatsappInboundMessages.leaseExpiresAt, now),
    ),
  );
}

async function configureWorkerClinic(
  transaction: ClinicTransaction,
  clinicId: string,
) {
  await transaction.execute(
    sql`select set_config('app.clinic_id', ${clinicId}, true)`,
  );
  const clinic = await transaction.query.clinics.findFirst({
    columns: { subscriptionStatus: true },
    where: eq(clinics.id, clinicId),
  });
  if (clinic === undefined) throw new Error("La Clínica no existe");
  await transaction.execute(
    sql`select set_config('app.subscription_status', ${clinic.subscriptionStatus}, true)`,
  );
  return clinic;
}

async function updateInboundResolution(
  transaction: ClinicTransaction,
  eventId: string,
  input: {
    clinicId: string;
    contactId?: string;
    identityId?: string;
    serviceWindowExpiresAt?: Date;
  },
) {
  await transaction
    .update(whatsappInboundMessages)
    .set({
      clinicId: input.clinicId,
      ...(input.contactId === undefined ? {} : { contactId: input.contactId }),
      ...(input.identityId === undefined
        ? {}
        : { identityId: input.identityId }),
      ...(input.serviceWindowExpiresAt === undefined
        ? {}
        : { serviceWindowExpiresAt: input.serviceWindowExpiresAt }),
    })
    .where(eq(whatsappInboundMessages.id, eventId));
}

async function insertIdentitySnapshot(
  transaction: ClinicTransaction,
  input: {
    clinicId: string;
    contactId?: string | null;
    message: WhatsAppInboundEvent;
    status: "conflict" | "unresolved";
  },
) {
  const [inserted] = await transaction
    .insert(whatsappIdentities)
    .values({
      businessScopedUserId: input.message.businessScopedUserId,
      clinicId: input.clinicId,
      contactId: input.contactId ?? null,
      parentBusinessScopedUserId: input.message.parentBusinessScopedUserId,
      phoneE164: input.message.phoneE164,
      phoneNumberId: input.message.phoneNumberId,
      sourceMessageId: input.message.id,
      status: input.status,
      observedAt: input.message.messageTimestamp ?? input.message.receivedAt,
      username: input.message.username,
      waId: input.message.fromWaId,
    })
    .returning({ id: whatsappIdentities.id });
  if (inserted === undefined) {
    throw new Error(
      "No se pudo conservar el snapshot de Identidad de WhatsApp",
    );
  }
  return inserted.id;
}

async function preserveIdentitySnapshot(
  transaction: ClinicTransaction,
  input: {
    clinicId: string;
    contactId: string;
    existing: WhatsAppIdentityRecord[];
    message: WhatsAppInboundEvent;
  },
) {
  const base = input.existing.find(
    (identity) =>
      identity.contactId === input.contactId &&
      identity.phoneNumberId === input.message.phoneNumberId &&
      ((input.message.businessScopedUserId !== null &&
        identity.businessScopedUserId === input.message.businessScopedUserId) ||
        (input.message.phoneE164 !== null &&
          identity.phoneE164 === input.message.phoneE164)),
  );
  const next: WhatsAppIdentityRecord = {
    businessScopedUserId:
      input.message.businessScopedUserId ?? base?.businessScopedUserId ?? null,
    contactId: input.contactId,
    id: "next",
    parentBusinessScopedUserId:
      input.message.parentBusinessScopedUserId ??
      base?.parentBusinessScopedUserId ??
      null,
    phoneE164: input.message.phoneE164 ?? base?.phoneE164 ?? null,
    phoneNumberId: input.message.phoneNumberId,
    status: "active",
    username: input.message.username ?? base?.username ?? null,
    waId: input.message.fromWaId ?? base?.waId ?? null,
  };
  const exact = input.existing.find(
    (identity) => !hasWhatsAppIdentityChanged(identity, next),
  );
  if (exact !== undefined) return exact.id;

  const related = input.existing.filter(
    (identity) =>
      identity.contactId === input.contactId &&
      ((next.businessScopedUserId !== null &&
        identity.businessScopedUserId === next.businessScopedUserId) ||
        (next.phoneE164 !== null && identity.phoneE164 === next.phoneE164)),
  );
  if (related.length > 0) {
    await transaction
      .update(whatsappIdentities)
      .set({ status: "historical" })
      .where(
        and(
          eq(whatsappIdentities.clinicId, input.clinicId),
          inArray(
            whatsappIdentities.id,
            related.map((identity) => identity.id),
          ),
          eq(whatsappIdentities.status, "active"),
        ),
      );
  }

  const [inserted] = await transaction
    .insert(whatsappIdentities)
    .values({
      businessScopedUserId: next.businessScopedUserId,
      clinicId: input.clinicId,
      contactId: input.contactId,
      parentBusinessScopedUserId: next.parentBusinessScopedUserId,
      phoneE164: next.phoneE164,
      phoneNumberId: next.phoneNumberId,
      sourceMessageId: input.message.id,
      status: "active",
      observedAt: input.message.messageTimestamp ?? input.message.receivedAt,
      username: next.username,
      waId: next.waId,
    })
    .returning({ id: whatsappIdentities.id });
  if (inserted === undefined) {
    throw new Error("No se pudo guardar la Identidad de WhatsApp");
  }
  return inserted.id;
}

function toIdentityRecord(
  row: typeof whatsappIdentities.$inferSelect,
): WhatsAppIdentityRecord {
  return {
    businessScopedUserId: row.businessScopedUserId,
    contactId: row.contactId,
    id: row.id,
    parentBusinessScopedUserId: row.parentBusinessScopedUserId,
    phoneE164: row.phoneE164,
    phoneNumberId: row.phoneNumberId,
    status: row.status,
    username: row.username,
    waId: row.waId,
  };
}

function toInboundEvent(
  row: typeof whatsappInboundMessages.$inferSelect,
): WhatsAppInboundEvent {
  return {
    attempts: row.attempts,
    batchSequence: row.batchSequence,
    businessScopedUserId: row.businessScopedUserId,
    conversationId: row.conversationId,
    customerId: row.customerId,
    direction: row.direction,
    eventId: row.id,
    eventName: "whatsapp.message.received",
    fromWaId: row.fromWaId,
    id: row.messageId,
    idempotencyKey: row.idempotencyKey,
    leaseToken: row.leaseToken,
    messageTimestamp: row.messageTimestamp,
    origin: row.origin,
    parentBusinessScopedUserId: row.parentBusinessScopedUserId,
    phoneE164: row.phoneE164,
    phoneNumberId: row.phoneNumberId,
    rawPayload: row.rawPayload,
    receivedAt: row.receivedAt,
    status: row.status,
    text: row.text,
    type: row.type,
    username: row.username,
  };
}
