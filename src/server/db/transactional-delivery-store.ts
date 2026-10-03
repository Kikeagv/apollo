import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNull,
  isNotNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  appointmentReminderCheckpoints,
  type AppointmentReminderCheckpoint,
} from "~/server/application/appointment-reminders";
import { whatsappOffboardingDeliverySuppressionReason } from "~/domain/whatsapp-offboarding";
import {
  retryAt,
  type TransactionalDeliveryCallbackObservation,
  type TransactionalDeliveryError,
  type TransactionalDeliveryCallbackStore,
  type TransactionalDelivery,
  type TransactionalDeliveryStore,
} from "~/server/application/transactional-deliveries";
import {
  buildTransactionalTemplateParameters,
  formatTransactionalAppointmentText,
  reconcileWhatsAppDeliveryStatus,
  whatsAppDeliveryStatusLabel,
  type TransactionalWhatsAppRoute,
  type TransactionalWhatsAppTemplate,
  type WhatsAppDeliveryStatus,
} from "~/domain/whatsapp-delivery";
import type {
  AppointmentTransactionalMessageType,
  ManualAppointmentMessageType,
} from "~/server/application/manual-appointments";
import type {
  TransactionalDeliveryStatusEvent,
  TransactionalDeliveryStatusStore,
} from "~/server/application/transactional-delivery-status";
import { TransactionalDeliveryStatusNotFoundError } from "~/server/application/transactional-delivery-status";
import {
  isKapsoDeliveryStatusEventName,
  type KapsoDeliveryStatusEvent,
} from "~/domain/whatsapp-delivery-events";
import {
  inAppointmentSchedulerTransaction,
  inClinicTransaction,
  inWhatsAppDeliveryStatusWorkerTransaction,
  inWhatsAppWebhookIngressTransaction,
  inWhatsAppOutboundWorkerTransaction,
  lockWhatsAppCircuit,
  setWhatsAppWorkerClinicContext,
} from "~/server/db/clinic-context";
import { readWhatsAppConsentSnapshot } from "~/server/db/whatsapp-consent-query";
import { recordSmokeReplyOutcome } from "~/server/db/whatsapp-smoke-run-store";
import { recordSmokeTemplateOutcome } from "~/server/db/whatsapp-smoke-template-store";
import { isWhatsAppCircuitOpenInTransaction } from "~/server/db/whatsapp-circuit-breaker-store";
import type { db } from "~/server/db";
import {
  appointmentEvents,
  appointments,
  clinicUsers,
  clinics,
  contactPatientLinks,
  contacts,
  doctors,
  patients,
  transactionalDeliveries,
  transactionalDeliveryAlerts,
  transactionalDeliveryAttempts,
  whatsappWebhookEvents,
  whatsappInboundMessages,
  whatsappInboundReplies,
  whatsappConnections,
  whatsappCriticalTemplates,
  whatsappIdentities,
  user,
} from "~/server/db/schema";

type SchedulerTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const HOUR_MS = 60 * 60_000;
const LEASE_MS = 10 * 60_000;
const RETAIN_MS = 365 * 24 * HOUR_MS;
const REMINDER_CATCH_UP_MS = 15 * 60_000;
const CIRCUIT_RETRY_DELAY_MS = 60_000;
const transactionalDeliveryCallback = alias(
  transactionalDeliveries,
  "transactionalDeliveryCallback",
);
const whatsappInboundReplyCallback = alias(
  whatsappInboundReplies,
  "whatsappInboundReplyCallback",
);

export function shouldSuppressWhatsAppReminder(input: {
  hasCurrentConsent: boolean;
  kind: TransactionalDelivery["kind"];
  recipientContactId: string | null;
}) {
  return (
    (input.kind === "appointment-reminder" ||
      input.kind === "appointment-message") &&
    (input.recipientContactId === null || !input.hasCurrentConsent)
  );
}

export function shouldSuppressOffboardedWhatsAppDelivery(input: {
  connectionOffboarded: boolean;
  kind: TransactionalDelivery["kind"];
}) {
  return (
    input.connectionOffboarded &&
    (input.kind === "appointment-message" ||
      input.kind === "appointment-reminder")
  );
}

async function isWhatsAppConnectionOffboarded(
  transaction: SchedulerTransaction,
  clinicId: string,
) {
  const connection = await transaction.query.whatsappConnections.findFirst({
    columns: { realTrafficStatus: true },
    where: eq(whatsappConnections.clinicId, clinicId),
  });
  return connection?.realTrafficStatus === "offboarded";
}

/** Persistencia del outbox y sus concesiones, siempre bajo RLS del worker. */
export const drizzleTransactionalDeliveryStore: TransactionalDeliveryStore = {
  async claimReadyDeliveries({ now }) {
    return inWhatsAppOutboundWorkerTransaction(async (transaction) => {
      const candidates = await transaction
        .select()
        .from(transactionalDeliveries)
        .where(
          or(
            and(
              eq(transactionalDeliveries.status, "pending"),
              lte(transactionalDeliveries.nextAttemptAt, now),
            ),
            and(
              eq(transactionalDeliveries.status, "processing"),
              lte(transactionalDeliveries.leaseExpiresAt, now),
            ),
          ),
        );
      const claimed: TransactionalDelivery[] = [];
      for (const candidate of candidates) {
        if (
          isWhatsAppDeliveryKind(candidate.kind) &&
          !(await setWhatsAppWorkerClinicContext(
            transaction,
            candidate.clinicId,
          ))
        ) {
          continue;
        }
        if (
          isWhatsAppDeliveryKind(candidate.kind) &&
          (await isWhatsAppCircuitOpenInTransaction(
            transaction,
            candidate.clinicId,
          ))
        ) {
          // El estado queda pending/processing para conservar la outbox y
          // permitir que la reactivación manual la drene después.
          continue;
        }
        const consentSnapshot =
          isWhatsAppDeliveryKind(candidate.kind) &&
          candidate.recipientContactId !== null
            ? await readWhatsAppConsentSnapshot(transaction, {
                clinicId: candidate.clinicId,
                contactId: candidate.recipientContactId,
                now,
                patientId:
                  candidate.appointmentId === null
                    ? null
                    : ((
                        await transaction.query.appointments.findFirst({
                          columns: { patientId: true },
                          where: and(
                            eq(appointments.clinicId, candidate.clinicId),
                            eq(appointments.id, candidate.appointmentId),
                          ),
                        })
                      )?.patientId ?? null),
              })
            : undefined;
        const hasCurrentConsent =
          !isWhatsAppDeliveryKind(candidate.kind) ||
          (candidate.recipientContactId !== null &&
            consentSnapshot?.decision === "allowed");
        if (
          shouldSuppressWhatsAppReminder({
            hasCurrentConsent,
            kind: candidate.kind,
            recipientContactId: candidate.recipientContactId,
          })
        ) {
          await transaction
            .update(transactionalDeliveries)
            .set({
              ...(consentSnapshot === undefined
                ? {}
                : {
                    consentAcceptedAt: consentSnapshot.acceptedAt,
                    consentDecision: consentSnapshot.decision,
                    consentPrivacyVersion: consentSnapshot.privacyVersion,
                    patientConsentReference: consentSnapshot.patientReference,
                    consentReference: consentSnapshot.reference,
                    consentTermsVersion: consentSnapshot.termsVersion,
                    consentTextReference: consentSnapshot.textReference,
                  }),
              lastError: "Consentimiento de WhatsApp no vigente",
              leaseExpiresAt: null,
              status: "suppressed",
              updatedAt: now,
            })
            .where(
              and(
                eq(transactionalDeliveries.id, candidate.id),
                or(
                  and(
                    eq(transactionalDeliveries.status, "pending"),
                    lte(transactionalDeliveries.nextAttemptAt, now),
                  ),
                  and(
                    eq(transactionalDeliveries.status, "processing"),
                    lte(transactionalDeliveries.leaseExpiresAt, now),
                  ),
                ),
              ),
            );
          continue;
        }
        if (
          candidate.recipientContactId !== null &&
          (await hasActiveRecipientDelivery(transaction, {
            clinicId: candidate.clinicId,
            contactId: candidate.recipientContactId,
            now,
          }))
        ) {
          continue;
        }
        const [delivery] = await transaction
          .update(transactionalDeliveries)
          .set({
            ...(consentSnapshot === undefined
              ? {}
              : {
                  consentAcceptedAt: consentSnapshot.acceptedAt,
                  consentDecision: consentSnapshot.decision,
                  consentPrivacyVersion: consentSnapshot.privacyVersion,
                  patientConsentReference: consentSnapshot.patientReference,
                  consentReference: consentSnapshot.reference,
                  consentTermsVersion: consentSnapshot.termsVersion,
                  consentTextReference: consentSnapshot.textReference,
                }),
            attempts: candidate.attempts + 1,
            leaseExpiresAt: new Date(now.valueOf() + LEASE_MS),
            status: "processing",
            updatedAt: now,
          })
          .where(
            and(
              eq(transactionalDeliveries.id, candidate.id),
              or(
                and(
                  eq(transactionalDeliveries.status, "pending"),
                  lte(transactionalDeliveries.nextAttemptAt, now),
                ),
                and(
                  eq(transactionalDeliveries.status, "processing"),
                  lte(transactionalDeliveries.leaseExpiresAt, now),
                ),
              ),
            ),
          )
          .returning();
        if (delivery !== undefined) claimed.push(toDelivery(delivery));
      }
      return claimed;
    });
  },

  async markAccepted({ delivery, now, providerMessageId }) {
    await inWhatsAppOutboundWorkerTransaction(async (transaction) => {
      const [updated] = await transaction
        .update(transactionalDeliveries)
        .set({
          leaseExpiresAt: null,
          providerMessageId,
          providerStatus: "accepted",
          status: "accepted",
          updatedAt: now,
        })
        .where(
          and(
            eq(transactionalDeliveries.id, delivery.id),
            eq(transactionalDeliveries.status, "processing"),
            eq(transactionalDeliveries.attempts, delivery.attempts),
          ),
        )
        .returning({ id: transactionalDeliveries.id });
      if (updated === undefined) return;
      await insertDeliveryAttempt(transaction, {
        attempt: delivery.attempts,
        clinicId: delivery.clinicId,
        deliveryId: delivery.id,
        occurredAt: now,
        outcome: "accepted",
        providerMessageId,
        providerStatus: "accepted",
        retainUntil: new Date(now.valueOf() + RETAIN_MS),
      });
      await recordAppointmentDeliveryEvent(
        transaction,
        delivery,
        "accepted",
        now,
      );
    });
  },

  async markDelivered({ delivery, now }) {
    await inWhatsAppOutboundWorkerTransaction(async (transaction) => {
      const [updated] = await transaction
        .update(transactionalDeliveries)
        .set({
          deliveredAt: now,
          leaseExpiresAt: null,
          providerStatus: "sent",
          status: "sent",
          updatedAt: now,
        })
        .where(
          and(
            eq(transactionalDeliveries.id, delivery.id),
            eq(transactionalDeliveries.status, "processing"),
            eq(transactionalDeliveries.attempts, delivery.attempts),
          ),
        )
        .returning({ id: transactionalDeliveries.id });
      if (updated === undefined) return;
      await insertDeliveryAttempt(transaction, {
        attempt: delivery.attempts,
        clinicId: delivery.clinicId,
        deliveryId: delivery.id,
        occurredAt: now,
        outcome: "delivered",
        providerStatus: "sent",
        retainUntil: new Date(now.valueOf() + RETAIN_MS),
      });
      await recordAppointmentDeliveryEvent(transaction, delivery, "sent", now);
    });
  },

  async markFailed({ delivery, error, now }) {
    await inWhatsAppOutboundWorkerTransaction(async (transaction) => {
      const [updated] = await transaction
        .update(transactionalDeliveries)
        .set({
          lastError: error.message.slice(0, 1_000),
          leaseExpiresAt: null,
          providerStatus: "failed",
          status: "failed",
          updatedAt: now,
        })
        .where(
          and(
            eq(transactionalDeliveries.id, delivery.id),
            eq(transactionalDeliveries.status, "processing"),
            eq(transactionalDeliveries.attempts, delivery.attempts),
          ),
        )
        .returning({ id: transactionalDeliveries.id });
      if (updated === undefined) return;
      await recordFailedDelivery(transaction, delivery, error.message, now);
    });
  },

  async markUnknown({ delivery, error, now }) {
    await inWhatsAppOutboundWorkerTransaction(async (transaction) => {
      const [updated] = await transaction
        .update(transactionalDeliveries)
        .set({
          lastError: error.message.slice(0, 1_000),
          leaseExpiresAt: null,
          nextAttemptAt: now,
          status: "unknown",
          updatedAt: now,
        })
        .where(
          and(
            eq(transactionalDeliveries.id, delivery.id),
            eq(transactionalDeliveries.status, "processing"),
            eq(transactionalDeliveries.attempts, delivery.attempts),
          ),
        )
        .returning({ id: transactionalDeliveries.id });
      if (updated === undefined) return;
      await insertDeliveryAttempt(transaction, {
        attempt: delivery.attempts,
        clinicId: delivery.clinicId,
        deliveryId: delivery.id,
        error: error.message.slice(0, 1_000),
        occurredAt: now,
        outcome: "unknown",
        retainUntil: new Date(now.valueOf() + RETAIN_MS),
      });
      await insertDeliveryAlert(transaction, delivery, now);
    });
  },

  async scheduleRetry({ delivery, error, now }) {
    await inWhatsAppOutboundWorkerTransaction(async (transaction) => {
      const nextAttemptAt = nextAttemptForError(delivery.attempts, error, now);
      if (nextAttemptAt !== undefined) {
        const [updated] = await transaction
          .update(transactionalDeliveries)
          .set({
            lastError: error.message.slice(0, 1_000),
            leaseExpiresAt: null,
            nextAttemptAt,
            status: "pending",
            updatedAt: now,
          })
          .where(
            and(
              eq(transactionalDeliveries.id, delivery.id),
              eq(transactionalDeliveries.status, "processing"),
              eq(transactionalDeliveries.attempts, delivery.attempts),
            ),
          )
          .returning({ id: transactionalDeliveries.id });
        if (updated === undefined) return;
        await insertDeliveryAttempt(transaction, {
          attempt: delivery.attempts,
          clinicId: delivery.clinicId,
          deliveryId: delivery.id,
          error: error.message.slice(0, 1_000),
          occurredAt: now,
          outcome: "failed",
          retainUntil: new Date(now.valueOf() + RETAIN_MS),
        });
        return;
      }
      const [updated] = await transaction
        .update(transactionalDeliveries)
        .set({
          lastError: error.message.slice(0, 1_000),
          leaseExpiresAt: null,
          status: "failed",
          providerStatus: "failed",
          updatedAt: now,
        })
        .where(
          and(
            eq(transactionalDeliveries.id, delivery.id),
            eq(transactionalDeliveries.status, "processing"),
            eq(transactionalDeliveries.attempts, delivery.attempts),
          ),
        )
        .returning({ id: transactionalDeliveries.id });
      if (updated === undefined) return;
      await insertDeliveryAttempt(transaction, {
        attempt: delivery.attempts,
        clinicId: delivery.clinicId,
        deliveryId: delivery.id,
        error: error.message.slice(0, 1_000),
        occurredAt: now,
        outcome: "failed",
        retainUntil: new Date(now.valueOf() + RETAIN_MS),
      });
      await insertDeliveryAlert(transaction, delivery, now);
    });
  },

  async deferForCircuit({ delivery, error, now }) {
    await inWhatsAppOutboundWorkerTransaction(async (transaction) => {
      await transaction
        .update(transactionalDeliveries)
        .set({
          attempts: sql`greatest(0, ${transactionalDeliveries.attempts} - 1)`,
          lastError: error.message.slice(0, 1_000),
          leaseExpiresAt: null,
          nextAttemptAt: new Date(now.valueOf() + CIRCUIT_RETRY_DELAY_MS),
          status: "pending",
          updatedAt: now,
        })
        .where(
          and(
            eq(transactionalDeliveries.id, delivery.id),
            eq(transactionalDeliveries.status, "processing"),
            eq(transactionalDeliveries.attempts, delivery.attempts),
          ),
        );
    });
  },
};

export const drizzleTransactionalDeliveryCallbackStore: TransactionalDeliveryCallbackStore =
  {
    async recordProviderCallback(input) {
      await inWhatsAppOutboundWorkerTransaction(async (transaction) => {
        const callbackNow = new Date();
        if (
          await recordSmokeTemplateOutcome(transaction, {
            idempotencyKey: input.idempotencyKey ?? "",
            now: callbackNow,
            phoneNumberId: input.phoneNumberId ?? null,
            providerEventId: input.providerEventId,
            providerEventReceivedAt:
              input.providerEventReceivedAt ?? callbackNow,
            providerMessageId: input.providerMessageId,
            status: input.status === "accepted" ? "sent" : input.status,
            error: input.error,
          })
        ) {
          return;
        }
        const delivery = await findDeliveryForCallback(transaction, input);
        if (delivery !== undefined) {
          const currentStatus = whatsappStatusFromDelivery(delivery.status);
          const reconciledStatus = reconcileWhatsAppDeliveryStatus(
            currentStatus,
            input.status,
          );
          await transaction
            .update(transactionalDeliveries)
            .set({
              deliveredAt:
                reconciledStatus === "delivered" || reconciledStatus === "read"
                  ? (delivery.deliveredAt ?? callbackNow)
                  : delivery.deliveredAt,
              leaseExpiresAt: null,
              providerMessageId:
                input.providerMessageId ?? delivery.providerMessageId,
              providerStatus: reconciledStatus,
              lastError:
                reconciledStatus === "failed"
                  ? (input.error ?? delivery.lastError ?? "Kapso reportó fallo")
                  : null,
              status: reconciledStatus,
              updatedAt: callbackNow,
            })
            .where(eq(transactionalDeliveries.id, delivery.id));
          const callbackInserted = await insertDeliveryCallbackAttempt(
            transaction,
            {
              attempt: 0,
              clinicId: delivery.clinicId,
              deliveryId: delivery.id,
              occurredAt: callbackNow,
              error: input.error,
              outcome: "callback",
              providerEventId: input.providerEventId,
              providerMessageId:
                input.providerMessageId ?? delivery.providerMessageId,
              providerStatus: input.status,
              retainUntil: delivery.retainUntil,
            },
          );
          if (callbackInserted && reconciledStatus !== currentStatus) {
            await recordAppointmentDeliveryEvent(
              transaction,
              delivery,
              reconciledStatus,
              callbackNow,
            );
          }
          if (callbackInserted && reconciledStatus === "failed") {
            await insertDeliveryAlert(transaction, delivery, callbackNow);
          }
          return callbackMetricObservation(delivery, input, callbackInserted);
        }

        const reply = await findReplyForCallback(transaction, input);
        if (reply !== undefined) {
          const currentStatus = whatsappStatusFromReply(reply.status);
          const reconciledStatus = reconcileWhatsAppDeliveryStatus(
            currentStatus,
            input.status,
          );
          const isNewProviderEvent =
            input.providerEventId !== undefined &&
            input.providerEventId !== null &&
            reply.lastProviderEventId !== input.providerEventId;
          await transaction
            .update(whatsappInboundReplies)
            .set({
              lastError:
                input.status === "failed"
                  ? (input.error ?? "Kapso reportó fallo")
                  : null,
              providerMessageId:
                input.providerMessageId ?? reply.providerMessageId,
              lastProviderEventId:
                input.providerEventId ?? reply.lastProviderEventId,
              sentAt:
                reconciledStatus === "sent" ||
                reconciledStatus === "delivered" ||
                reconciledStatus === "read"
                  ? (reply.sentAt ?? new Date())
                  : reply.sentAt,
              status: reconciledStatus,
            })
            .where(eq(whatsappInboundReplies.id, reply.id));
          if (
            reconciledStatus === "delivered" ||
            reconciledStatus === "read" ||
            reconciledStatus === "failed"
          ) {
            await recordSmokeReplyOutcome(transaction, {
              clinicId: reply.clinicId,
              idempotencyKey: reply.idempotencyKey,
              now: callbackNow,
              outcome:
                reconciledStatus === "failed"
                  ? "delivery-failed"
                  : reconciledStatus,
              providerEventId: input.providerEventId,
              providerMessageId:
                input.providerMessageId ?? reply.providerMessageId,
            });
          }
          return replyCallbackMetricObservation(
            reply,
            input,
            isNewProviderEvent,
          );
        }

        throw new TransactionalDeliveryStatusNotFoundError();
      });
    },
  };

export const drizzleTransactionalDeliveryStatusStore: TransactionalDeliveryStatusStore =
  {
    async claimDueStatusEvents({ limit, now }) {
      return inWhatsAppDeliveryStatusWorkerTransaction(async (transaction) => {
        const candidates = await transaction
          .select()
          .from(whatsappWebhookEvents)
          .where(
            and(
              inArray(whatsappWebhookEvents.eventName, [
                "whatsapp.message.sent",
                "whatsapp.message.delivered",
                "whatsapp.message.read",
                "whatsapp.message.failed",
              ]),
              or(
                and(
                  eq(whatsappWebhookEvents.status, "pending"),
                  or(
                    isNull(whatsappWebhookEvents.nextAttemptAt),
                    lte(whatsappWebhookEvents.nextAttemptAt, now),
                  ),
                ),
                and(
                  eq(whatsappWebhookEvents.status, "processing"),
                  lte(whatsappWebhookEvents.leaseExpiresAt, now),
                ),
              ),
            ),
          )
          .orderBy(asc(whatsappWebhookEvents.receivedAt))
          .limit(limit);
        const claimed: TransactionalDeliveryStatusEvent[] = [];
        for (const candidate of candidates) {
          if (!isKapsoDeliveryStatusEventName(candidate.eventName)) continue;
          const leaseToken = randomUUID();
          const [event] = await transaction
            .update(whatsappWebhookEvents)
            .set({
              attempts: candidate.attempts + 1,
              lastError: null,
              leaseExpiresAt: new Date(now.valueOf() + LEASE_MS),
              leaseToken,
              nextAttemptAt: null,
              status: "processing",
            })
            .where(
              and(
                eq(whatsappWebhookEvents.id, candidate.id),
                inArray(whatsappWebhookEvents.eventName, [
                  "whatsapp.message.sent",
                  "whatsapp.message.delivered",
                  "whatsapp.message.read",
                  "whatsapp.message.failed",
                ]),
                or(
                  and(
                    eq(whatsappWebhookEvents.status, "pending"),
                    or(
                      isNull(whatsappWebhookEvents.nextAttemptAt),
                      lte(whatsappWebhookEvents.nextAttemptAt, now),
                    ),
                  ),
                  and(
                    eq(whatsappWebhookEvents.status, "processing"),
                    lte(whatsappWebhookEvents.leaseExpiresAt, now),
                  ),
                ),
              ),
            )
            .returning();
          if (event === undefined) continue;
          claimed.push({
            attempts: event.attempts,
            eventName: event.eventName as KapsoDeliveryStatusEvent["eventName"],
            id: event.id,
            idempotencyKey: event.idempotencyKey,
            leaseToken: event.leaseToken,
            payload: event.payload,
            receivedAt: event.receivedAt,
            status: "processing",
          });
        }
        return claimed;
      });
    },

    async markStatusProcessed({ eventId, leaseToken, processedAt }) {
      await inWhatsAppDeliveryStatusWorkerTransaction(async (transaction) => {
        await transaction
          .update(whatsappWebhookEvents)
          .set({
            leaseExpiresAt: null,
            leaseToken: null,
            nextAttemptAt: null,
            processedAt,
            status: "processed",
          })
          .where(
            and(
              eq(whatsappWebhookEvents.id, eventId),
              eq(whatsappWebhookEvents.leaseToken, leaseToken),
              eq(whatsappWebhookEvents.status, "processing"),
            ),
          );
      });
    },

    async markStatusRejected({ eventId, leaseToken, processedAt, reason }) {
      await inWhatsAppDeliveryStatusWorkerTransaction(async (transaction) => {
        await transaction
          .update(whatsappWebhookEvents)
          .set({
            lastError: reason.slice(0, 1_000),
            leaseExpiresAt: null,
            leaseToken: null,
            nextAttemptAt: null,
            rejectedAt: processedAt,
            status: "rejected",
          })
          .where(
            and(
              eq(whatsappWebhookEvents.id, eventId),
              eq(whatsappWebhookEvents.leaseToken, leaseToken),
              eq(whatsappWebhookEvents.status, "processing"),
            ),
          );
      });
    },

    async scheduleStatusRetry({
      eventId,
      leaseToken,
      nextAttemptAt,
      reason,
      retriedAt,
    }) {
      await inWhatsAppDeliveryStatusWorkerTransaction(async (transaction) => {
        await transaction
          .update(whatsappWebhookEvents)
          .set({
            lastError: reason.slice(0, 1_000),
            leaseExpiresAt: null,
            leaseToken: null,
            nextAttemptAt,
            status: "pending",
          })
          .where(
            and(
              eq(whatsappWebhookEvents.id, eventId),
              eq(whatsappWebhookEvents.leaseToken, leaseToken),
              eq(whatsappWebhookEvents.status, "processing"),
            ),
          );
        void retriedAt;
      });
    },
  };

/** Inserta el estado Kapso después de autenticarlo, sin resolverlo en HTTP. */
export async function enqueueTransactionalDeliveryStatus(input: {
  event: KapsoDeliveryStatusEvent;
  idempotencyKey: string;
}) {
  return inWhatsAppWebhookIngressTransaction(async (transaction) => {
    const [inserted] = await transaction
      .insert(whatsappWebhookEvents)
      .values({
        eventName: input.event.eventName,
        idempotencyKey: input.idempotencyKey,
        payload: input.event.rawPayload,
        status: "pending",
      })
      .onConflictDoNothing({ target: whatsappWebhookEvents.idempotencyKey })
      .returning({ id: whatsappWebhookEvents.id });
    return {
      accepted: inserted !== undefined,
      eventId: inserted?.id ?? "duplicate",
    };
  });
}

type ManualAppointmentTransactionalDeliveryInput = {
  actorIdentityId: string;
  message: {
    appointmentId: string;
    clinicId: string;
    idempotencyKey?: string;
    recipient: { id: string; name: string; phoneE164: string | null };
    recipientBusinessScopedUserId?: string | null;
    route?: TransactionalWhatsAppRoute;
    type: ManualAppointmentMessageType;
  };
  now: Date;
};

async function readAppointmentDeliveryContext(
  transaction: SchedulerTransaction,
  input: { appointmentId: string; clinicId: string },
) {
  const appointment = await transaction.query.appointments.findFirst({
    columns: { doctorId: true, patientId: true, startsAt: true },
    where: and(
      eq(appointments.clinicId, input.clinicId),
      eq(appointments.id, input.appointmentId),
    ),
  });
  if (appointment === undefined) {
    throw new Error("La Cita no existe para crear su Entrega");
  }
  const [doctor, patient] = await Promise.all([
    transaction.query.doctors.findFirst({
      columns: { publicName: true },
      where: and(
        eq(doctors.clinicId, input.clinicId),
        eq(doctors.id, appointment.doctorId),
      ),
    }),
    appointment.patientId === null
      ? undefined
      : transaction.query.patients.findFirst({
          columns: { name: true },
          where: and(
            eq(patients.clinicId, input.clinicId),
            eq(patients.id, appointment.patientId),
          ),
        }),
  ]);
  return {
    doctorName: doctor?.publicName ?? null,
    patientName: patient?.name ?? null,
    patientId: appointment.patientId,
    startsAt: appointment.startsAt,
  };
}

/** Convierte la notificación de una Cita manual en una Entrega durable. */
export async function enqueueManualAppointmentTransactionalDelivery(
  input: ManualAppointmentTransactionalDeliveryInput,
  existingTransaction?: SchedulerTransaction,
) {
  const appointment =
    existingTransaction === undefined
      ? await inClinicTransaction(
          {
            clinicId: input.message.clinicId,
            identityId: input.actorIdentityId,
          },
          (transaction) =>
            readAppointmentDeliveryContext(transaction, {
              appointmentId: input.message.appointmentId,
              clinicId: input.message.clinicId,
            }),
        )
      : await readAppointmentDeliveryContext(existingTransaction, {
          appointmentId: input.message.appointmentId,
          clinicId: input.message.clinicId,
        });

  const insertDelivery = async (transaction: SchedulerTransaction) => {
    await insertAppointmentTransactionalDelivery(transaction, {
      appointment,
      appointmentId: input.message.appointmentId,
      clinicId: input.message.clinicId,
      idempotencyKey:
        input.message.idempotencyKey ??
        `${input.message.appointmentId}:${input.message.type}:${input.message.recipient.id}`,
      now: input.now,
      recipient: input.message.recipient,
      recipientBusinessScopedUserId:
        input.message.recipientBusinessScopedUserId,
      route: input.message.route,
      type: input.message.type,
    });
  };

  return existingTransaction === undefined
    ? inWhatsAppOutboundWorkerTransaction(insertDelivery)
    : insertDelivery(existingTransaction);
}

/** Inserta la Entrega dentro de la transacción de la Cita que la originó. */
export function enqueueManualAppointmentTransactionalDeliveryInTransaction(
  transaction: SchedulerTransaction,
  input: ManualAppointmentTransactionalDeliveryInput,
) {
  return enqueueManualAppointmentTransactionalDelivery(input, transaction);
}

/** Guarda la confirmación, cancelación o reprogramación junto con su evento. */
export async function enqueueAppointmentTransactionalDeliveryInTransaction(
  transaction: SchedulerTransaction,
  input: {
    appointmentEventId: string;
    appointmentId: string;
    clinicId: string;
    contactId: string;
    now: Date;
    type: "cancellation" | "confirmation" | "reschedule";
  },
) {
  const appointment = await readAppointmentDeliveryContext(transaction, {
    appointmentId: input.appointmentId,
    clinicId: input.clinicId,
  });
  await setWhatsAppWorkerClinicContext(transaction, input.clinicId);
  const recipient = await transaction.query.contacts.findFirst({
    columns: { id: true, name: true, phoneE164: true },
    where: and(
      eq(contacts.clinicId, input.clinicId),
      eq(contacts.id, input.contactId),
    ),
  });
  if (recipient === undefined) {
    throw new Error("El Contacto no existe para crear su Entrega");
  }
  const recipientBusinessScopedUserId =
    await latestWhatsAppBusinessScopedUserId(
      transaction,
      input.clinicId,
      input.contactId,
    );

  await insertAppointmentTransactionalDelivery(transaction, {
    appointment,
    appointmentId: input.appointmentId,
    clinicId: input.clinicId,
    idempotencyKey: `${input.appointmentId}:${input.type}:${input.appointmentEventId}:${input.contactId}`,
    now: input.now,
    recipient,
    recipientBusinessScopedUserId,
    type: input.type,
  });
}

async function insertAppointmentTransactionalDelivery(
  transaction: SchedulerTransaction,
  input: {
    appointment: Awaited<ReturnType<typeof readAppointmentDeliveryContext>>;
    appointmentId: string;
    clinicId: string;
    idempotencyKey: string;
    now: Date;
    recipient: { id: string; name: string; phoneE164: string | null };
    recipientBusinessScopedUserId?: string | null;
    route?: TransactionalWhatsAppRoute;
    type: AppointmentTransactionalMessageType;
  },
) {
  await transaction.execute(
    sql`select set_config('app.whatsapp_outbound_worker', 'true', true)`,
  );
  await setWhatsAppWorkerClinicContext(transaction, input.clinicId);
  await lockWhatsAppCircuit(transaction, input.clinicId);
  const connectionOffboarded = await isWhatsAppConnectionOffboarded(
    transaction,
    input.clinicId,
  );
  const suppressForOffboarding = shouldSuppressOffboardedWhatsAppDelivery({
    connectionOffboarded,
    kind: "appointment-message",
  });
  const consent = await readWhatsAppConsentSnapshot(transaction, {
    clinicId: input.clinicId,
    contactId: input.recipient.id,
    now: input.now,
    patientId: input.appointment.patientId,
  });
  const clinic = await transaction.query.clinics.findFirst({
    columns: { name: true },
    where: eq(clinics.id, input.clinicId),
  });
  if (clinic === undefined) throw new Error("La Clínica no existe");
  const templateKind =
    input.type === "manual-confirmation" || input.type === "confirmation"
      ? "confirmation"
      : input.type === "manual-cancellation" || input.type === "cancellation"
        ? "cancellation"
        : "reschedule";
  const template = await readTemplateSnapshot(
    transaction,
    input.clinicId,
    templateKind,
    {
      clinicName: clinic.name,
      doctorName: input.appointment.doctorName,
      patientName: input.appointment.patientName,
      startsAt: input.appointment.startsAt,
    },
  );
  const text = formatTransactionalAppointmentText({
    clinicName: clinic.name,
    doctorName: input.appointment.doctorName,
    kind: templateKind,
    startsAt: input.appointment.startsAt,
  });
  const serviceWindowExpiresAt = await latestServiceWindowExpiry(
    transaction,
    input.clinicId,
    input.recipient.id,
  );
  await transaction
    .insert(transactionalDeliveries)
    .values({
      appointmentId: input.appointmentId,
      clinicId: input.clinicId,
      consentAcceptedAt: consent.acceptedAt,
      consentDecision: consent.decision,
      consentPrivacyVersion: consent.privacyVersion,
      patientConsentReference: consent.patientReference,
      consentReference: consent.reference,
      consentTermsVersion: consent.termsVersion,
      consentTextReference: consent.textReference,
      idempotencyKey: input.idempotencyKey,
      kind: "appointment-message",
      lastError: suppressForOffboarding
        ? whatsappOffboardingDeliverySuppressionReason
        : consent.decision === "blocked"
          ? "Consentimiento de WhatsApp no vigente"
          : null,
      nextAttemptAt: input.now,
      payload: {
        appointmentId: input.appointmentId,
        doctorName: input.appointment.doctorName,
        patientName: input.appointment.patientName,
        recipient: input.recipient,
        recipientBusinessScopedUserId:
          input.recipientBusinessScopedUserId ?? null,
        route: input.route,
        serviceWindowExpiresAt,
        template,
        text,
        type: input.type,
      },
      recipientContactId: input.recipient.id,
      status:
        suppressForOffboarding || consent.decision === "blocked"
          ? "suppressed"
          : "pending",
      retainUntil: new Date(input.now.valueOf() + RETAIN_MS),
    })
    .onConflictDoNothing();
}

/** Prepara decisiones de Agenda y las inserta de forma idempotente en el outbox. */
export async function enqueueDueTransactionalDeliveries(input: { now: Date }) {
  return inAppointmentSchedulerTransaction(async (transaction) => {
    let reminders = 0;
    const appointments = await dueAppointments(transaction, input.now);
    const clinicIds = [
      ...new Set(appointments.map(({ clinicId }) => clinicId)),
    ];
    for (const clinicId of clinicIds.sort((left, right) =>
      left.localeCompare(right),
    )) {
      await lockWhatsAppCircuit(transaction, clinicId);
    }
    for (const appointment of appointments) {
      if (appointment.patientId === null) continue;
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${appointment.clinicId}, true)`,
      );
      const connectionOffboarded = await isWhatsAppConnectionOffboarded(
        transaction,
        appointment.clinicId,
      );
      for (const checkpoint of appointmentReminderCheckpoints) {
        const dueNow = isCheckpointDue(
          appointment.startsAt,
          checkpoint,
          input.now,
        );
        const preparingFutureCheckpoint =
          checkpoint !== "24h" &&
          isCheckpointDue(appointment.startsAt, "24h", input.now);
        if (!dueNow && !preparingFutureCheckpoint) continue;
        const recipients = await reminderRecipients(transaction, appointment);
        for (const recipient of recipients) {
          const consent = await readWhatsAppConsentSnapshot(transaction, {
            clinicId: appointment.clinicId,
            contactId: recipient.id,
            now: input.now,
            patientId: appointment.patientId,
          });
          const template = await readTemplateSnapshot(
            transaction,
            appointment.clinicId,
            "reminder",
            {
              clinicName: appointment.clinicName,
              doctorName: appointment.doctorName,
              patientName: appointment.patientName,
              startsAt: appointment.startsAt,
            },
          );
          const text = formatTransactionalAppointmentText({
            clinicName: appointment.clinicName,
            doctorName: appointment.doctorName,
            kind: "reminder",
            startsAt: appointment.startsAt,
          });
          const serviceWindowExpiresAt = await latestServiceWindowExpiry(
            transaction,
            appointment.clinicId,
            recipient.id,
          );
          const recipientBusinessScopedUserId =
            await latestWhatsAppBusinessScopedUserId(
              transaction,
              appointment.clinicId,
              recipient.id,
            );
          const suppressForOffboarding =
            shouldSuppressOffboardedWhatsAppDelivery({
              connectionOffboarded,
              kind: "appointment-reminder",
            });
          const [inserted] = await transaction
            .insert(transactionalDeliveries)
            .values({
              appointmentId: appointment.id,
              clinicId: appointment.clinicId,
              idempotencyKey: `${appointment.id}:${checkpoint}:${recipient.id}`,
              kind: "appointment-reminder",
              nextAttemptAt: new Date(
                appointment.startsAt.valueOf() -
                  Number.parseInt(checkpoint, 10) * HOUR_MS,
              ),
              status:
                suppressForOffboarding || consent.decision === "blocked"
                  ? "suppressed"
                  : "pending",
              consentAcceptedAt: consent.acceptedAt,
              consentDecision: consent.decision,
              consentPrivacyVersion: consent.privacyVersion,
              patientConsentReference: consent.patientReference,
              consentReference: consent.reference,
              consentTermsVersion: consent.termsVersion,
              consentTextReference: consent.textReference,
              lastError: suppressForOffboarding
                ? whatsappOffboardingDeliverySuppressionReason
                : consent.decision === "blocked"
                  ? "Consentimiento de WhatsApp no vigente"
                  : null,
              payload: {
                appointmentId: appointment.id,
                appointmentStartsAt: appointment.startsAt,
                checkpoint,
                clinicName: appointment.clinicName,
                doctorName: appointment.doctorName,
                patientName: appointment.patientName,
                recipientBusinessScopedUserId,
                recipient,
                serviceWindowExpiresAt,
                template,
                text,
              },
              recipientContactId: recipient.id,
              retainUntil: new Date(input.now.valueOf() + RETAIN_MS),
            })
            .onConflictDoNothing()
            .returning({ id: transactionalDeliveries.id });
          if (inserted !== undefined) reminders += 1;
        }
      }
    }
    const agendas = await enqueueDailyAgendas(transaction, input.now);
    return { agendas, reminders };
  });
}

export async function purgeExpiredTransactionalDeliveries(input: {
  now: Date;
}) {
  return inAppointmentSchedulerTransaction(async (transaction) =>
    transaction
      .delete(transactionalDeliveries)
      .where(lte(transactionalDeliveries.retainUntil, input.now))
      .returning({ id: transactionalDeliveries.id })
      .then((rows) => rows.length),
  );
}

/** Una respuesta del Contacto solo suprime futuros hitos pendientes. */
export async function suppressPendingReminderDeliveries(input: {
  clinicId: string;
  contactId: string;
  now: Date;
}) {
  return inAppointmentSchedulerTransaction(async (transaction) => {
    const activeTwentyFourHourDelivery = await transaction
      .select({ appointmentId: transactionalDeliveries.appointmentId })
      .from(transactionalDeliveries)
      .innerJoin(
        appointments,
        and(
          eq(transactionalDeliveries.clinicId, appointments.clinicId),
          eq(transactionalDeliveries.appointmentId, appointments.id),
        ),
      )
      .where(
        and(
          eq(transactionalDeliveries.clinicId, input.clinicId),
          eq(transactionalDeliveries.recipientContactId, input.contactId),
          eq(transactionalDeliveries.kind, "appointment-reminder"),
          inArray(transactionalDeliveries.status, [
            "accepted",
            "delivered",
            "read",
            "sent",
          ]),
          gt(appointments.startsAt, input.now),
          sql`${transactionalDeliveries.payload}->>'checkpoint' = '24h'`,
        ),
      )
      .then((rows) => rows[0]);
    if (
      activeTwentyFourHourDelivery?.appointmentId === null ||
      activeTwentyFourHourDelivery === undefined
    )
      return 0;
    const rows = await transaction
      .update(transactionalDeliveries)
      .set({ status: "suppressed", updatedAt: input.now })
      .where(
        and(
          eq(transactionalDeliveries.clinicId, input.clinicId),
          eq(
            transactionalDeliveries.appointmentId,
            activeTwentyFourHourDelivery.appointmentId,
          ),
          eq(transactionalDeliveries.recipientContactId, input.contactId),
          eq(transactionalDeliveries.status, "pending"),
          sql`${transactionalDeliveries.payload}->>'checkpoint' IN ('22h', '20h')`,
        ),
      )
      .returning({ id: transactionalDeliveries.id });
    return rows.length;
  });
}

/** Un opt-out cancela cualquier Entrega de WhatsApp proactiva aún pendiente. */
export async function suppressPendingWhatsAppDeliveries(input: {
  clinicId: string;
  contactId: string;
  now: Date;
}) {
  return inAppointmentSchedulerTransaction(async (transaction) => {
    const consent = await readWhatsAppConsentSnapshot(transaction, input);
    const rows = await transaction
      .update(transactionalDeliveries)
      .set({
        consentAcceptedAt: consent.acceptedAt,
        consentDecision: consent.decision,
        consentPrivacyVersion: consent.privacyVersion,
        consentReference: consent.reference,
        consentTermsVersion: consent.termsVersion,
        consentTextReference: consent.textReference,
        lastError: "El Contacto revocó el Consentimiento de WhatsApp",
        leaseExpiresAt: null,
        status: "suppressed",
        updatedAt: input.now,
      })
      .where(
        and(
          eq(transactionalDeliveries.clinicId, input.clinicId),
          eq(transactionalDeliveries.recipientContactId, input.contactId),
          inArray(transactionalDeliveries.kind, [
            "appointment-message",
            "appointment-reminder",
          ]),
          eq(transactionalDeliveries.status, "pending"),
        ),
      )
      .returning({ id: transactionalDeliveries.id });
    return rows.length;
  });
}

/** Un consentimiento explícito nuevo libera solo las Entregas bloqueadas por consentimiento. */
export async function reactivatePendingWhatsAppDeliveries(input: {
  clinicId: string;
  consentReference: string;
  contactId: string;
  now: Date;
}) {
  return inAppointmentSchedulerTransaction(async (transaction) => {
    if (!(await setWhatsAppWorkerClinicContext(transaction, input.clinicId))) {
      return 0;
    }
    const channelConsent = await readWhatsAppConsentSnapshot(
      transaction,
      input,
    );
    if (
      channelConsent.decision !== "allowed" ||
      channelConsent.reference !== input.consentReference
    ) {
      return 0;
    }
    const candidates = await transaction
      .select({
        appointmentId: transactionalDeliveries.appointmentId,
        id: transactionalDeliveries.id,
        kind: transactionalDeliveries.kind,
      })
      .from(transactionalDeliveries)
      .where(
        and(
          eq(transactionalDeliveries.clinicId, input.clinicId),
          eq(transactionalDeliveries.recipientContactId, input.contactId),
          inArray(transactionalDeliveries.kind, [
            "appointment-message",
            "appointment-reminder",
          ]),
          eq(transactionalDeliveries.status, "suppressed"),
          or(
            eq(transactionalDeliveries.kind, "appointment-message"),
            and(
              eq(transactionalDeliveries.kind, "appointment-reminder"),
              gte(
                transactionalDeliveries.nextAttemptAt,
                new Date(input.now.valueOf() - REMINDER_CATCH_UP_MS),
              ),
              sql`${transactionalDeliveries.payload}->>'checkpoint' IN ('20h', '22h', '24h')`,
              exists(
                transaction
                  .select({ id: appointments.id })
                  .from(appointments)
                  .where(
                    and(
                      eq(
                        appointments.clinicId,
                        transactionalDeliveries.clinicId,
                      ),
                      eq(
                        appointments.id,
                        transactionalDeliveries.appointmentId,
                      ),
                      eq(appointments.status, "confirmed"),
                      gt(appointments.startsAt, input.now),
                    ),
                  ),
              ),
            ),
          ),
          inArray(transactionalDeliveries.lastError, [
            "Consentimiento de WhatsApp no vigente",
            "El Contacto revocó el Consentimiento de WhatsApp",
          ]),
        ),
      );
    let reactivated = 0;
    for (const candidate of candidates) {
      if (candidate.appointmentId === null) continue;
      const appointment = await transaction.query.appointments.findFirst({
        columns: { patientId: true },
        where: and(
          eq(appointments.clinicId, input.clinicId),
          eq(appointments.id, candidate.appointmentId),
        ),
      });
      if (appointment?.patientId == null) continue;
      const consent = await readWhatsAppConsentSnapshot(transaction, {
        ...input,
        patientId: appointment.patientId,
      });
      if (
        consent.decision !== "allowed" ||
        consent.reference !== input.consentReference
      ) {
        continue;
      }
      const rows = await transaction
        .update(transactionalDeliveries)
        .set({
          consentAcceptedAt: consent.acceptedAt,
          consentDecision: consent.decision,
          consentPrivacyVersion: consent.privacyVersion,
          patientConsentReference: consent.patientReference,
          consentReference: consent.reference,
          consentTermsVersion: consent.termsVersion,
          consentTextReference: consent.textReference,
          lastError: null,
          leaseExpiresAt: null,
          status: "pending",
          updatedAt: input.now,
        })
        .where(
          and(
            eq(transactionalDeliveries.clinicId, input.clinicId),
            eq(transactionalDeliveries.id, candidate.id),
            eq(transactionalDeliveries.recipientContactId, input.contactId),
            eq(transactionalDeliveries.status, "suppressed"),
          ),
        )
        .returning({ id: transactionalDeliveries.id });
      reactivated += rows.length;
    }
    return reactivated;
  });
}

export type TransactionalDeliveryAlert = {
  createdAt: Date;
  delivery: {
    idempotencyKey: string;
    kind: string;
    lastError: string | null;
    resolutionEvidence: string | null;
  };
  id: string;
};

export async function listTransactionalDeliveryAlerts(input: {
  clinicId: string;
  identityId: string;
}): Promise<TransactionalDeliveryAlert[]> {
  return inClinicTransaction(input, async (transaction) =>
    transaction
      .select({
        createdAt: transactionalDeliveryAlerts.createdAt,
        deliveryIdempotencyKey: transactionalDeliveries.idempotencyKey,
        deliveryKind: transactionalDeliveries.kind,
        lastError: transactionalDeliveries.lastError,
        id: transactionalDeliveryAlerts.id,
        resolutionEvidence: transactionalDeliveryAlerts.resolutionEvidence,
      })
      .from(transactionalDeliveryAlerts)
      .innerJoin(
        transactionalDeliveries,
        eq(transactionalDeliveryAlerts.deliveryId, transactionalDeliveries.id),
      )
      .where(
        and(
          eq(transactionalDeliveryAlerts.clinicId, input.clinicId),
          isNull(transactionalDeliveryAlerts.resolvedAt),
        ),
      )
      .then((alerts) =>
        alerts.map((alert) => ({
          createdAt: alert.createdAt,
          delivery: {
            idempotencyKey: alert.deliveryIdempotencyKey,
            kind: alert.deliveryKind,
            lastError: alert.lastError,
            resolutionEvidence: alert.resolutionEvidence,
          },
          id: alert.id,
        })),
      ),
  );
}

export async function resolveTransactionalDeliveryAlert(input: {
  alertId: string;
  clinicId: string;
  identityId: string;
  now: Date;
  resolutionEvidence: string;
}) {
  const resolutionEvidence = input.resolutionEvidence.trim();
  if (resolutionEvidence === "") return false;
  return inClinicTransaction(input, async (transaction) => {
    const member = await transaction.query.clinicUsers.findFirst({
      columns: { id: true },
      where: and(
        eq(clinicUsers.clinicId, input.clinicId),
        eq(clinicUsers.identityId, input.identityId),
        eq(clinicUsers.active, true),
      ),
    });
    if (member === undefined) return false;
    const [alert] = await transaction
      .update(transactionalDeliveryAlerts)
      .set({
        resolutionEvidence,
        resolvedAt: input.now,
        resolvedByClinicUserId: member.id,
      })
      .where(
        and(
          eq(transactionalDeliveryAlerts.id, input.alertId),
          eq(transactionalDeliveryAlerts.clinicId, input.clinicId),
          isNull(transactionalDeliveryAlerts.resolvedAt),
        ),
      )
      .returning({ id: transactionalDeliveryAlerts.id });
    return alert !== undefined;
  });
}

/** Adaptador explícito para que Pendientes delegue la resolución de Entregas. */
export const drizzleTransactionalDeliveryAlertResolver = {
  resolveTransactionalDeliveryAlert,
};

function isWhatsAppDeliveryKind(
  kind: TransactionalDelivery["kind"],
): kind is "appointment-message" | "appointment-reminder" {
  return kind === "appointment-message" || kind === "appointment-reminder";
}

function nextAttemptForError(
  attempts: number,
  error: TransactionalDeliveryError,
  now: Date,
) {
  if (error.retryable === false || attempts > 4) return undefined;
  if (error.nextAttemptAt !== undefined && error.nextAttemptAt !== null) {
    if (error.nextAttemptAt > now) return error.nextAttemptAt;
  }
  return retryAt(attempts, now);
}

type DeliveryAttemptInput = {
  attempt: number;
  clinicId: string;
  deliveryId: string;
  error?: string | null;
  occurredAt: Date;
  outcome:
    | "accepted"
    | "callback"
    | "delivered"
    | "failed"
    | "read"
    | "sent"
    | "unknown";
  providerEventId?: string | null;
  providerMessageId?: string | null;
  providerStatus?: string | null;
  retainUntil: Date;
};

async function insertDeliveryAttempt(
  transaction: SchedulerTransaction,
  input: DeliveryAttemptInput,
) {
  await transaction.insert(transactionalDeliveryAttempts).values(input);
}

async function insertDeliveryCallbackAttempt(
  transaction: SchedulerTransaction,
  input: DeliveryAttemptInput,
) {
  const insert = transaction
    .insert(transactionalDeliveryAttempts)
    .values(input);
  if (input.providerEventId === undefined || input.providerEventId === null) {
    const rows = await insert.returning({
      id: transactionalDeliveryAttempts.id,
    });
    return rows.length > 0;
  }
  const rows = await insert
    .onConflictDoNothing({
      target: [
        transactionalDeliveryAttempts.deliveryId,
        transactionalDeliveryAttempts.providerEventId,
      ],
      where: sql`
        ${transactionalDeliveryAttempts.outcome} = 'callback'
        AND ${transactionalDeliveryAttempts.providerEventId} IS NOT NULL
      `,
    })
    .returning({ id: transactionalDeliveryAttempts.id });
  return rows.length > 0;
}

async function insertDeliveryAlert(
  transaction: SchedulerTransaction,
  delivery: Pick<TransactionalDelivery, "clinicId" | "id">,
  now: Date,
) {
  await transaction
    .insert(transactionalDeliveryAlerts)
    .values({
      clinicId: delivery.clinicId,
      deliveryId: delivery.id,
      retainUntil: new Date(now.valueOf() + RETAIN_MS),
    })
    .onConflictDoNothing();
}

/** Serializa llamadas externas para un Contacto entre workers concurrentes. */
async function hasActiveRecipientDelivery(
  transaction: SchedulerTransaction,
  input: { clinicId: string; contactId: string; now: Date },
) {
  const lockKey = `transactional-delivery:${input.clinicId}:${input.contactId}`;
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
  );
  const active = await transaction.query.transactionalDeliveries.findFirst({
    columns: { id: true },
    where: and(
      eq(transactionalDeliveries.clinicId, input.clinicId),
      eq(transactionalDeliveries.recipientContactId, input.contactId),
      eq(transactionalDeliveries.status, "processing"),
      gt(transactionalDeliveries.leaseExpiresAt, input.now),
    ),
  });
  return active !== undefined;
}

async function recordFailedDelivery(
  transaction: SchedulerTransaction,
  delivery: TransactionalDelivery,
  reason: string,
  now: Date,
) {
  const error = reason.slice(0, 1_000);
  await insertDeliveryAttempt(transaction, {
    attempt: delivery.attempts,
    clinicId: delivery.clinicId,
    deliveryId: delivery.id,
    error,
    occurredAt: now,
    outcome: "failed",
    retainUntil: new Date(now.valueOf() + RETAIN_MS),
  });
  await insertDeliveryAlert(transaction, delivery, now);
  await recordAppointmentDeliveryEvent(transaction, delivery, "failed", now);
}

async function recordAppointmentDeliveryEvent(
  transaction: SchedulerTransaction,
  delivery: {
    clinicId: string;
    kind: string;
    payload: unknown;
  },
  status: WhatsAppDeliveryStatus,
  now: Date,
) {
  const source = toAppointmentDeliveryEventSource(delivery);
  if (source === undefined) return;
  const owner = await activeOwner(transaction, source.clinicId);
  if (owner === undefined) return;
  const type = "appointment-delivery-status";
  const messageType =
    source.kind === "appointment-reminder"
      ? "Recordatorio"
      : source.payload.type === "manual-confirmation" ||
          source.payload.type === "confirmation"
        ? "Confirmación"
        : source.payload.type === "manual-cancellation" ||
            source.payload.type === "cancellation"
          ? "Cancelación"
          : "Reprogramación";
  const statusLabel = whatsAppDeliveryStatusLabel(status);
  await transaction.insert(appointmentEvents).values({
    actorClinicUserId: owner.id,
    appointmentId: source.payload.appointmentId,
    clinicId: source.clinicId,
    occurredAt: now,
    reason: [
      messageType,
      statusLabel,
      source.kind === "appointment-reminder" ? source.payload.checkpoint : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" · "),
    recipientContactId: source.payload.recipient.id,
    type,
  });
}

type AppointmentDeliveryEventSource = {
  clinicId: string;
  kind: "appointment-message" | "appointment-reminder";
  payload: {
    appointmentId: string;
    checkpoint?: AppointmentReminderCheckpoint;
    recipient: { id: string };
    type?: AppointmentTransactionalMessageType;
  };
};

function toAppointmentDeliveryEventSource(input: {
  clinicId: string;
  kind: string;
  payload: unknown;
}): AppointmentDeliveryEventSource | undefined {
  if (
    input.kind !== "appointment-message" &&
    input.kind !== "appointment-reminder"
  ) {
    return undefined;
  }
  const payload = asRecord(input.payload);
  const recipient = asRecord(payload.recipient);
  if (
    typeof payload.appointmentId !== "string" ||
    typeof recipient.id !== "string"
  ) {
    return undefined;
  }
  const type =
    payload.type === "manual-confirmation" ||
    payload.type === "manual-cancellation" ||
    payload.type === "confirmation" ||
    payload.type === "cancellation" ||
    payload.type === "reschedule"
      ? payload.type
      : undefined;
  const checkpoint =
    payload.checkpoint === "20h" ||
    payload.checkpoint === "22h" ||
    payload.checkpoint === "24h"
      ? payload.checkpoint
      : undefined;
  if (
    (input.kind === "appointment-message" && type === undefined) ||
    (input.kind === "appointment-reminder" && checkpoint === undefined)
  ) {
    return undefined;
  }
  return {
    clinicId: input.clinicId,
    kind: input.kind,
    payload: {
      appointmentId: payload.appointmentId,
      ...(checkpoint === undefined ? {} : { checkpoint }),
      recipient: { id: recipient.id },
      ...(type === undefined ? {} : { type }),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function callbackMetricObservation(
  delivery: Pick<
    typeof transactionalDeliveries.$inferSelect,
    "clinicId" | "payload"
  >,
  input: {
    error?: string | null;
    providerEventId?: string | null;
    status: "accepted" | "sent" | "delivered" | "read" | "failed";
  },
  isNew: boolean,
): TransactionalDeliveryCallbackObservation | undefined {
  if (
    input.providerEventId === undefined ||
    input.providerEventId === null ||
    (input.status !== "delivered" &&
      input.status !== "failed" &&
      input.status !== "read")
  ) {
    return undefined;
  }
  const route = asRecord(delivery.payload.route);
  const routeKind = route.kind;
  const category =
    input.status === "read"
      ? ("read-receipt" as const)
      : routeKind === "template"
        ? ("template" as const)
        : routeKind === "interactive"
          ? ("interactive" as const)
          : ("message" as const);
  return {
    clinicId: delivery.clinicId,
    errorCode:
      input.error === null || input.error === undefined
        ? null
        : "provider-error",
    idempotencyKey: `delivery-status:${input.providerEventId}`,
    isNew,
    metric: { category, direction: "outbound" },
    operation: "transactional-delivery-status",
    outcome: input.status,
    templateName:
      category === "template" && typeof route.name === "string"
        ? route.name
        : null,
  };
}

function replyCallbackMetricObservation(
  reply: Pick<
    typeof whatsappInboundReplies.$inferSelect,
    "clinicId" | "buttonLabel"
  >,
  input: {
    error?: string | null;
    providerEventId?: string | null;
    status: "accepted" | "sent" | "delivered" | "read" | "failed";
  },
  isNew: boolean,
): TransactionalDeliveryCallbackObservation | undefined {
  if (
    input.providerEventId === undefined ||
    input.providerEventId === null ||
    (input.status !== "delivered" &&
      input.status !== "failed" &&
      input.status !== "read")
  ) {
    return undefined;
  }
  return {
    clinicId: reply.clinicId,
    errorCode:
      input.error === null || input.error === undefined
        ? null
        : "provider-error",
    idempotencyKey: `inbound-reply-status:${input.providerEventId}`,
    isNew,
    metric: {
      category: reply.buttonLabel === null ? "message" : "interactive",
      direction: "outbound",
    },
    operation: "inbound-reply",
    outcome: input.status,
    templateName: null,
  };
}

function whatsappStatusFromDelivery(
  status: typeof transactionalDeliveries.$inferSelect.status,
): WhatsAppDeliveryStatus | null {
  return isWhatsAppDeliveryStatus(status) ? status : null;
}

function whatsappStatusFromReply(
  status: typeof whatsappInboundReplies.$inferSelect.status,
): WhatsAppDeliveryStatus | null {
  return isWhatsAppDeliveryStatus(status) ? status : null;
}

function isWhatsAppDeliveryStatus(
  status: string,
): status is WhatsAppDeliveryStatus {
  return (
    status === "accepted" ||
    status === "sent" ||
    status === "delivered" ||
    status === "read" ||
    status === "failed"
  );
}

async function findDeliveryForCallback(
  transaction: SchedulerTransaction,
  input: {
    idempotencyKey?: string | null;
    phoneNumberId?: string | null;
    providerMessageId?: string | null;
  },
) {
  const predicates = [
    ...(input.idempotencyKey === undefined || input.idempotencyKey === null
      ? []
      : [
          eq(
            transactionalDeliveryCallback.idempotencyKey,
            input.idempotencyKey,
          ),
        ]),
    ...(input.providerMessageId === undefined ||
    input.providerMessageId === null
      ? []
      : [
          eq(
            transactionalDeliveryCallback.providerMessageId,
            input.providerMessageId,
          ),
        ]),
    ...(input.phoneNumberId === undefined || input.phoneNumberId === null
      ? []
      : [
          exists(
            transaction
              .select({ clinicId: whatsappConnections.clinicId })
              .from(whatsappConnections)
              .where(
                and(
                  eq(
                    whatsappConnections.clinicId,
                    transactionalDeliveryCallback.clinicId,
                  ),
                  eq(whatsappConnections.phoneNumberId, input.phoneNumberId),
                  eq(whatsappConnections.provider, "kapso"),
                ),
              ),
          ),
        ]),
  ];
  if (predicates.length === 0) return undefined;
  const [delivery] = await transaction
    .select({
      clinicId: transactionalDeliveryCallback.clinicId,
      deliveredAt: transactionalDeliveryCallback.deliveredAt,
      id: transactionalDeliveryCallback.id,
      idempotencyKey: transactionalDeliveryCallback.idempotencyKey,
      kind: transactionalDeliveryCallback.kind,
      lastError: transactionalDeliveryCallback.lastError,
      payload: transactionalDeliveryCallback.payload,
      providerMessageId: transactionalDeliveryCallback.providerMessageId,
      retainUntil: transactionalDeliveryCallback.retainUntil,
      status: transactionalDeliveryCallback.status,
    })
    .from(transactionalDeliveryCallback)
    .where(and(...predicates))
    .limit(1);
  return delivery;
}

async function findReplyForCallback(
  transaction: SchedulerTransaction,
  input: {
    idempotencyKey?: string | null;
    phoneNumberId?: string | null;
    providerMessageId?: string | null;
  },
) {
  const predicates = [
    ...(input.idempotencyKey === undefined || input.idempotencyKey === null
      ? []
      : [
          eq(whatsappInboundReplyCallback.idempotencyKey, input.idempotencyKey),
        ]),
    ...(input.providerMessageId === undefined ||
    input.providerMessageId === null
      ? []
      : [
          eq(
            whatsappInboundReplyCallback.providerMessageId,
            input.providerMessageId,
          ),
        ]),
    ...(input.phoneNumberId === undefined || input.phoneNumberId === null
      ? []
      : [
          exists(
            transaction
              .select({ clinicId: whatsappConnections.clinicId })
              .from(whatsappConnections)
              .where(
                and(
                  eq(
                    whatsappConnections.clinicId,
                    whatsappInboundReplyCallback.clinicId,
                  ),
                  eq(whatsappConnections.phoneNumberId, input.phoneNumberId),
                  eq(whatsappConnections.provider, "kapso"),
                ),
              ),
          ),
        ]),
  ];
  if (predicates.length === 0) return undefined;
  const [reply] = await transaction
    .select({
      buttonLabel: whatsappInboundReplyCallback.buttonLabel,
      clinicId: whatsappInboundReplyCallback.clinicId,
      id: whatsappInboundReplyCallback.id,
      idempotencyKey: whatsappInboundReplyCallback.idempotencyKey,
      lastProviderEventId: whatsappInboundReplyCallback.lastProviderEventId,
      providerMessageId: whatsappInboundReplyCallback.providerMessageId,
      sentAt: whatsappInboundReplyCallback.sentAt,
      status: whatsappInboundReplyCallback.status,
    })
    .from(whatsappInboundReplyCallback)
    .where(and(...predicates))
    .limit(1)
    .for("update");
  return reply;
}

async function latestServiceWindowExpiry(
  transaction: SchedulerTransaction,
  clinicId: string,
  contactId: string,
) {
  const [message] = await transaction
    .select({
      serviceWindowExpiresAt: whatsappInboundMessages.serviceWindowExpiresAt,
    })
    .from(whatsappInboundMessages)
    .where(
      and(
        eq(whatsappInboundMessages.clinicId, clinicId),
        eq(whatsappInboundMessages.contactId, contactId),
        isNotNull(whatsappInboundMessages.serviceWindowExpiresAt),
      ),
    )
    .orderBy(desc(whatsappInboundMessages.receivedAt))
    .limit(1);
  return message?.serviceWindowExpiresAt ?? null;
}

async function latestWhatsAppBusinessScopedUserId(
  transaction: SchedulerTransaction,
  clinicId: string,
  contactId: string,
) {
  const [identity] = await transaction
    .select({ businessScopedUserId: whatsappIdentities.businessScopedUserId })
    .from(whatsappIdentities)
    .where(
      and(
        eq(whatsappIdentities.clinicId, clinicId),
        eq(whatsappIdentities.contactId, contactId),
        eq(whatsappIdentities.status, "active"),
        isNotNull(whatsappIdentities.businessScopedUserId),
      ),
    )
    .orderBy(desc(whatsappIdentities.observedAt))
    .limit(1);
  return identity?.businessScopedUserId ?? null;
}

async function readTemplateSnapshot(
  transaction: SchedulerTransaction,
  clinicId: string,
  kind: "cancellation" | "confirmation" | "reminder" | "reschedule",
  values: {
    clinicName: string;
    doctorName?: string | null;
    patientName?: string | null;
    startsAt: Date;
  },
): Promise<TransactionalWhatsAppTemplate> {
  const template = await transaction.query.whatsappCriticalTemplates.findFirst({
    columns: {
      category: true,
      name: true,
      providerTemplateId: true,
      status: true,
      variables: true,
      locale: true,
    },
    where: and(
      eq(whatsappCriticalTemplates.clinicId, clinicId),
      eq(whatsappCriticalTemplates.kind, kind),
    ),
  });
  if (template === undefined) {
    return {
      category: null,
      locale: "",
      name: "",
      parameters: [],
      providerTemplateId: null,
      status: null,
    };
  }
  return {
    category: template.category,
    locale: template.locale,
    name: template.name,
    parameters: buildTransactionalTemplateParameters(
      template.variables,
      values,
    ),
    providerTemplateId: template.providerTemplateId,
    status: template.status,
  };
}

async function dueAppointments(transaction: SchedulerTransaction, now: Date) {
  return transaction
    .select({
      authorContactId: appointments.authorContactId,
      clinicId: appointments.clinicId,
      clinicName: clinics.name,
      doctorName: doctors.publicName,
      id: appointments.id,
      origin: appointments.origin,
      patientId: appointments.patientId,
      patientName: patients.name,
      startsAt: appointments.startsAt,
    })
    .from(appointments)
    .innerJoin(clinics, eq(appointments.clinicId, clinics.id))
    .innerJoin(
      doctors,
      and(
        eq(appointments.clinicId, doctors.clinicId),
        eq(appointments.doctorId, doctors.id),
      ),
    )
    .leftJoin(
      patients,
      and(
        eq(appointments.clinicId, patients.clinicId),
        eq(appointments.patientId, patients.id),
      ),
    )
    .where(
      and(
        eq(appointments.status, "confirmed"),
        gte(appointments.startsAt, new Date(now.valueOf() + 19 * HOUR_MS)),
        lte(appointments.startsAt, new Date(now.valueOf() + 24 * HOUR_MS)),
      ),
    );
}

async function reminderRecipients(
  transaction: SchedulerTransaction,
  appointment: Awaited<ReturnType<typeof dueAppointments>>[number],
) {
  return transaction
    .select({
      id: contacts.id,
      name: contacts.name,
      phoneE164: contacts.phoneE164,
    })
    .from(contactPatientLinks)
    .innerJoin(
      patients,
      and(
        eq(contactPatientLinks.clinicId, patients.clinicId),
        eq(contactPatientLinks.patientId, patients.id),
      ),
    )
    .innerJoin(
      contacts,
      and(
        eq(contactPatientLinks.clinicId, contacts.clinicId),
        eq(contactPatientLinks.contactId, contacts.id),
      ),
    )
    .where(
      and(
        eq(contactPatientLinks.clinicId, appointment.clinicId),
        eq(contactPatientLinks.patientId, appointment.patientId!),
        whatsAppManagedPatientLinkCondition(),
        appointment.origin === "manual"
          ? undefined
          : or(
              eq(contactPatientLinks.relationship, "tutor"),
              appointment.authorContactId === null
                ? undefined
                : eq(
                    contactPatientLinks.contactId,
                    appointment.authorContactId,
                  ),
            ),
      ),
    );
}

function whatsAppManagedPatientLinkCondition() {
  return or(
    and(
      eq(contactPatientLinks.relationship, "contact"),
      sql`${patients.birthDate} <= CURRENT_DATE - INTERVAL '18 years'`,
    ),
    and(
      eq(contactPatientLinks.relationship, "tutor"),
      eq(contactPatientLinks.guardianshipVerificationStatus, "verified"),
      sql`upper(regexp_replace(btrim(${contactPatientLinks.guardianDeclaration}), '[[:space:]]+', ' ', 'g')) = 'DECLARO REPRESENTACIÓN AUTORIZADA'`,
      sql`${contactPatientLinks.guardianDui} ~ '^[0-9]{8}-[0-9]$'`,
    ),
  );
}

async function enqueueDailyAgendas(
  transaction: SchedulerTransaction,
  now: Date,
) {
  if (now.getUTCHours() !== 8) return 0;
  const agendaDate = new Date(now.valueOf() - 6 * HOUR_MS)
    .toISOString()
    .slice(0, 10);
  const recipients = await transaction
    .select({
      clinicId: clinics.id,
      clinicName: clinics.name,
      doctorId: doctors.id,
      doctorName: doctors.publicName,
      recipientEmail: user.email,
    })
    .from(doctors)
    .innerJoin(clinics, eq(doctors.clinicId, clinics.id))
    .innerJoin(
      clinicUsers,
      and(
        eq(doctors.clinicId, clinicUsers.clinicId),
        eq(doctors.clinicUserId, clinicUsers.id),
      ),
    )
    .innerJoin(user, eq(clinicUsers.identityId, user.id))
    .where(and(eq(doctors.active, true), eq(clinicUsers.active, true)));
  let agendas = 0;
  for (const recipient of recipients) {
    const agenda = await transaction
      .select({ patientName: patients.name, startsAt: appointments.startsAt })
      .from(appointments)
      .innerJoin(
        patients,
        and(
          eq(appointments.clinicId, patients.clinicId),
          eq(appointments.patientId, patients.id),
        ),
      )
      .where(
        and(
          eq(appointments.clinicId, recipient.clinicId),
          eq(appointments.doctorId, recipient.doctorId),
          eq(appointments.status, "confirmed"),
          gte(appointments.startsAt, now),
          lt(appointments.startsAt, new Date(now.valueOf() + 7 * 24 * HOUR_MS)),
        ),
      );
    const [inserted] = await transaction
      .insert(transactionalDeliveries)
      .values({
        clinicId: recipient.clinicId,
        idempotencyKey: `${recipient.doctorId}:${agendaDate}`,
        kind: "daily-agenda-pdf",
        nextAttemptAt: now,
        payload: {
          agenda,
          clinicName: recipient.clinicName,
          doctorName: recipient.doctorName ?? "Médico sin nombre público",
          recipientEmail: recipient.recipientEmail,
        },
        retainUntil: new Date(now.valueOf() + RETAIN_MS),
      })
      .onConflictDoNothing()
      .returning({ id: transactionalDeliveries.id });
    if (inserted !== undefined) agendas += 1;
  }
  return agendas;
}

async function activeOwner(
  transaction: SchedulerTransaction,
  clinicId: string,
) {
  return transaction.query.clinicUsers.findFirst({
    columns: { id: true },
    where: and(
      eq(clinicUsers.clinicId, clinicId),
      eq(clinicUsers.role, "owner"),
      eq(clinicUsers.active, true),
    ),
  });
}

function isCheckpointDue(
  startsAt: Date,
  checkpoint: AppointmentReminderCheckpoint,
  now: Date,
) {
  const scheduledAt = new Date(
    startsAt.valueOf() - Number.parseInt(checkpoint, 10) * HOUR_MS,
  );
  return (
    scheduledAt <= now &&
    now.valueOf() - scheduledAt.valueOf() <= REMINDER_CATCH_UP_MS
  );
}

function toDelivery(
  row: typeof transactionalDeliveries.$inferSelect,
): TransactionalDelivery {
  const payload = row.payload;
  if (row.kind === "appointment-message") {
    const message = payload as {
      appointmentId: string;
      doctorName?: string | null;
      patientName?: string | null;
      recipientBusinessScopedUserId?: string | null;
      recipient: { id: string; name: string; phoneE164: string | null };
      route?: TransactionalWhatsAppRoute;
      serviceWindowExpiresAt?: string | null;
      template?: TransactionalWhatsAppTemplate;
      text?: string;
      type: AppointmentTransactionalMessageType;
    };
    return {
      attempts: row.attempts,
      clinicId: row.clinicId,
      id: row.id,
      idempotencyKey: row.idempotencyKey,
      kind: row.kind,
      payload: {
        ...message,
        serviceWindowExpiresAt: optionalDate(message.serviceWindowExpiresAt),
      },
    };
  }
  if (row.kind === "appointment-reminder") {
    const reminder = payload as {
      appointmentId: string;
      appointmentStartsAt: string;
      checkpoint: AppointmentReminderCheckpoint;
      clinicName: string;
      doctorName?: string | null;
      patientName?: string | null;
      recipientBusinessScopedUserId?: string | null;
      recipient: { id: string; name: string; phoneE164: string | null };
      route?: TransactionalWhatsAppRoute;
      serviceWindowExpiresAt?: string | null;
      template?: TransactionalWhatsAppTemplate;
      text?: string;
    };
    return {
      attempts: row.attempts,
      clinicId: row.clinicId,
      id: row.id,
      idempotencyKey: row.idempotencyKey,
      kind: row.kind,
      payload: {
        ...reminder,
        appointmentStartsAt: new Date(reminder.appointmentStartsAt),
        serviceWindowExpiresAt: optionalDate(reminder.serviceWindowExpiresAt),
      },
    };
  }
  const agenda = payload as {
    agenda: Array<{ patientName: string; startsAt: string }>;
    clinicName: string;
    doctorName: string;
    recipientEmail: string;
  };
  return {
    attempts: row.attempts,
    clinicId: row.clinicId,
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    kind: row.kind,
    payload: {
      ...agenda,
      agenda: agenda.agenda.map((item) => ({
        ...item,
        startsAt: new Date(item.startsAt),
      })),
    },
  };
}

function optionalDate(value: Date | string | null | undefined) {
  return value === undefined || value === null ? value : new Date(value);
}
