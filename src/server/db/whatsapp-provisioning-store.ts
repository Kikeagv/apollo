import { randomUUID } from "node:crypto";

import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import type {
  KapsoProvisioningConnection,
  KapsoProvisioningEvent,
  KapsoProvisioningStepState,
  KapsoProvisioningStore,
} from "~/server/application/whatsapp-provisioning";
import type { KapsoPhoneNumberLifecycleEvent } from "~/domain/whatsapp-kapso-provisioning";
import {
  inWhatsAppProvisioningWorkerTransaction,
  inWhatsAppWebhookIngressTransaction,
  type ClinicTransaction,
} from "~/server/db/clinic-context";
import { drizzleWhatsAppInboundStore } from "~/server/db/whatsapp-inbound-store";
import { enqueueTransactionalDeliveryStatus } from "~/server/db/transactional-delivery-store";
import { isWhatsAppCircuitOpenInTransaction } from "~/server/db/whatsapp-circuit-breaker-store";
import {
  clinics,
  whatsappConnections,
  whatsappProvisioningSteps,
  whatsappWebhookEvents,
} from "~/server/db/schema";

const PROVISIONING_LEASE_MS = 10 * 60_000;
const MAX_PROVISIONING_ATTEMPTS = 3;

export const drizzleWhatsAppProvisioningStore: KapsoProvisioningStore = {
  enqueueInbound: (input) => drizzleWhatsAppInboundStore.enqueueInbound(input),
  enqueueDeliveryStatus: (input) => enqueueTransactionalDeliveryStatus(input),

  async claimDueEvents({ limit, now }) {
    return inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      const candidates = await transaction
        .select()
        .from(whatsappWebhookEvents)
        .where(
          and(
            inArray(whatsappWebhookEvents.eventName, [
              "whatsapp.phone_number.created",
              "whatsapp.phone_number.deleted",
            ]),
            or(
              and(
                eq(whatsappWebhookEvents.status, "pending"),
                lt(whatsappWebhookEvents.attempts, MAX_PROVISIONING_ATTEMPTS),
                or(
                  isNull(whatsappWebhookEvents.nextAttemptAt),
                  lte(whatsappWebhookEvents.nextAttemptAt, now),
                ),
              ),
              and(
                eq(whatsappWebhookEvents.status, "processing"),
                lte(whatsappWebhookEvents.attempts, MAX_PROVISIONING_ATTEMPTS),
                lte(whatsappWebhookEvents.leaseExpiresAt, now),
              ),
            ),
          ),
        )
        .limit(limit);
      const claimed: KapsoProvisioningEvent[] = [];

      for (const candidate of candidates) {
        if (
          await isProvisioningEventCircuitOpen(transaction, candidate.payload)
        ) {
          continue;
        }
        const [event] = await transaction
          .update(whatsappWebhookEvents)
          .set({
            attempts:
              candidate.status === "processing" &&
              candidate.attempts >= MAX_PROVISIONING_ATTEMPTS
                ? candidate.attempts
                : candidate.attempts + 1,
            leaseExpiresAt: new Date(now.valueOf() + PROVISIONING_LEASE_MS),
            leaseToken: randomUUID(),
            status: "processing",
          })
          .where(
            and(
              eq(whatsappWebhookEvents.id, candidate.id),
              inArray(whatsappWebhookEvents.eventName, [
                "whatsapp.phone_number.created",
                "whatsapp.phone_number.deleted",
              ]),
              or(
                and(
                  eq(whatsappWebhookEvents.status, "pending"),
                  lt(whatsappWebhookEvents.attempts, MAX_PROVISIONING_ATTEMPTS),
                  or(
                    isNull(whatsappWebhookEvents.nextAttemptAt),
                    lte(whatsappWebhookEvents.nextAttemptAt, now),
                  ),
                ),
                and(
                  eq(whatsappWebhookEvents.status, "processing"),
                  lte(
                    whatsappWebhookEvents.attempts,
                    MAX_PROVISIONING_ATTEMPTS,
                  ),
                  lte(whatsappWebhookEvents.leaseExpiresAt, now),
                ),
              ),
            ),
          )
          .returning();
        if (event !== undefined) {
          claimed.push(
            toProvisioningEvent(event, candidate.status === "processing"),
          );
        }
      }
      return claimed;
    });
  },

  async enqueue({ event, idempotencyKey }) {
    return inWhatsAppWebhookIngressTransaction(async (transaction) => {
      const [inserted] = await transaction
        .insert(whatsappWebhookEvents)
        .values({
          eventName: event.eventName,
          idempotencyKey,
          payload: event,
          status: "pending",
        })
        .onConflictDoNothing({ target: whatsappWebhookEvents.idempotencyKey })
        .returning({ id: whatsappWebhookEvents.id });
      if (inserted !== undefined) {
        return { accepted: true, eventId: inserted.id };
      }

      return { accepted: false, eventId: "duplicate" };
    });
  },

  async enqueueIgnored({ eventName, idempotencyKey, payload }) {
    return inWhatsAppWebhookIngressTransaction(async (transaction) => {
      const [inserted] = await transaction
        .insert(whatsappWebhookEvents)
        .values({
          eventName,
          idempotencyKey,
          lastError: "Evento reservado para el siguiente slice de mensajería",
          payload,
          status: "ignored",
        })
        .onConflictDoNothing({ target: whatsappWebhookEvents.idempotencyKey })
        .returning({ id: whatsappWebhookEvents.id });
      if (inserted !== undefined) {
        return { accepted: true, eventId: inserted.id };
      }
      return { accepted: false, eventId: "duplicate" };
    });
  },

  async getStep({ clinicId, eventId, phoneNumberId, step }) {
    return inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      const result =
        await transaction.query.whatsappProvisioningSteps.findFirst({
          columns: { remoteId: true, status: true },
          where: and(
            eq(whatsappProvisioningSteps.clinicId, clinicId),
            eq(whatsappProvisioningSteps.eventId, eventId),
            eq(whatsappProvisioningSteps.phoneNumberId, phoneNumberId),
            eq(whatsappProvisioningSteps.step, step),
          ),
        });
      return result === undefined
        ? undefined
        : ({
            remoteId: result.remoteId ?? undefined,
            status: result.status,
          } satisfies KapsoProvisioningStepState);
    });
  },

  async hasNewerCreatedEvent({ event, eventId, receivedAt }) {
    return inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      const candidates = await transaction
        .select({ id: whatsappWebhookEvents.id })
        .from(whatsappWebhookEvents)
        .where(
          and(
            ne(whatsappWebhookEvents.id, eventId),
            eq(
              whatsappWebhookEvents.eventName,
              "whatsapp.phone_number.created",
            ),
            inArray(whatsappWebhookEvents.status, [
              "pending",
              "processing",
              "processed",
            ]),
            gte(whatsappWebhookEvents.receivedAt, receivedAt),
            sql`${whatsappWebhookEvents.payload}->>'phoneNumberId' = ${event.phoneNumberId}`,
            sql`${whatsappWebhookEvents.payload}->>'customerId' = ${event.customerId}`,
            sql`${whatsappWebhookEvents.payload}->>'projectId' = ${event.projectId}`,
          ),
        )
        .limit(1);
      return candidates.length > 0;
    });
  },

  async markProcessed({ eventId, leaseToken, processedAt }) {
    await inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      await transaction
        .update(whatsappWebhookEvents)
        .set({
          lastError: null,
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

  async markRejected({ eventId, leaseToken, reason, rejectedAt }) {
    await inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      await transaction
        .update(whatsappWebhookEvents)
        .set({
          lastError: reason.slice(0, 1_000),
          leaseExpiresAt: null,
          leaseToken: null,
          nextAttemptAt: null,
          rejectedAt,
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

  async resolveConnection({ event }) {
    return inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      const [byCustomer, byPhone, byBusinessAccount] = await Promise.all([
        transaction.query.whatsappConnections.findFirst({
          where: eq(whatsappConnections.customer, event.customerId),
        }),
        transaction.query.whatsappConnections.findFirst({
          where: eq(whatsappConnections.phoneNumberId, event.phoneNumberId),
        }),
        event.businessAccountId === null
          ? Promise.resolve(undefined)
          : transaction.query.whatsappConnections.findFirst({
              where: eq(
                whatsappConnections.businessAccountId,
                event.businessAccountId,
              ),
            }),
      ]);
      const candidates = [byCustomer, byPhone, byBusinessAccount].filter(
        (candidate): candidate is NonNullable<typeof candidate> =>
          candidate !== undefined,
      );
      const clinicIds = new Set(
        candidates.map((candidate) => candidate.clinicId),
      );
      if (candidates.length === 0) return { kind: "unknown" as const };
      if (clinicIds.size !== 1) return { kind: "crossed" as const };

      const connection = candidates[0];
      if (connection?.provider !== "kapso") {
        return { kind: "crossed" as const };
      }
      if (
        connection.customer !== event.customerId ||
        (event.eventName === "whatsapp.phone_number.deleted" &&
          connection.phoneNumberId !== event.phoneNumberId) ||
        (connection.phoneNumberId !== null &&
          connection.phoneNumberId !== event.phoneNumberId) ||
        (event.businessAccountId !== null &&
          connection.businessAccountId !== null &&
          connection.businessAccountId !== event.businessAccountId) ||
        (connection.metadata.projectId !== undefined &&
          connection.metadata.projectId !== null &&
          connection.metadata.projectId !== event.projectId)
      ) {
        return { kind: "crossed" as const };
      }
      return {
        connection: toProvisioningConnection(connection),
        kind: "matched" as const,
      };
    });
  },

  async saveStep(input) {
    await inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      const [activeLease] = await transaction
        .select({ id: whatsappWebhookEvents.id })
        .from(whatsappWebhookEvents)
        .where(
          and(
            eq(whatsappWebhookEvents.id, input.eventId),
            eq(whatsappWebhookEvents.leaseToken, input.leaseToken),
            eq(whatsappWebhookEvents.status, "processing"),
          ),
        )
        .for("update");
      if (activeLease === undefined) return;

      await transaction
        .insert(whatsappProvisioningSteps)
        .values({
          clinicId: input.clinicId,
          completedAt: input.status === "succeeded" ? input.updatedAt : null,
          eventId: input.eventId,
          lastError: input.error?.slice(0, 1_000) ?? null,
          attempts: 1,
          phoneNumberId: input.phoneNumberId,
          projectId: input.projectId,
          remoteId: input.remoteId ?? null,
          status: input.status,
          step: input.step,
          updatedAt: input.updatedAt,
        })
        .onConflictDoUpdate({
          target: [
            whatsappProvisioningSteps.eventId,
            whatsappProvisioningSteps.step,
          ],
          set: {
            attempts: sql`${whatsappProvisioningSteps.attempts} + 1`,
            completedAt: input.status === "succeeded" ? input.updatedAt : null,
            lastError: input.error?.slice(0, 1_000) ?? null,
            remoteId: input.remoteId ?? null,
            projectId: input.projectId,
            status: input.status,
            updatedAt: input.updatedAt,
          },
        });
    });
  },

  async scheduleRetry({
    eventId,
    leaseToken,
    nextAttemptAt,
    reason,
    retriedAt,
  }) {
    await inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
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

  async pauseForCircuit({ eventId, leaseToken, pausedAt, reason }) {
    await inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      await transaction
        .update(whatsappWebhookEvents)
        .set({
          attempts: 0,
          lastError: reason.slice(0, 1_000),
          leaseExpiresAt: null,
          leaseToken: null,
          nextAttemptAt: pausedAt,
          status: "pending",
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

  async updateConnection(input) {
    await inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      const [activeLease] = await transaction
        .select({ id: whatsappWebhookEvents.id })
        .from(whatsappWebhookEvents)
        .where(
          and(
            eq(whatsappWebhookEvents.id, input.eventId),
            eq(whatsappWebhookEvents.leaseToken, input.leaseToken),
            eq(whatsappWebhookEvents.status, "processing"),
          ),
        )
        .for("update");
      if (activeLease === undefined) return;

      await transaction.execute(
        sql`select set_config('app.clinic_id', ${input.clinicId}, true)`,
      );
      const clinic = await transaction.query.clinics.findFirst({
        columns: { subscriptionStatus: true },
        where: eq(clinics.id, input.clinicId),
      });
      if (clinic === undefined) throw new Error("La Clínica no existe");
      await transaction.execute(
        sql`select set_config('app.subscription_status', ${clinic.subscriptionStatus}, true)`,
      );
      await transaction
        .update(whatsappConnections)
        .set({
          ...(input.businessAccountId === undefined
            ? {}
            : { businessAccountId: input.businessAccountId }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
          ...(input.phoneNumberE164 === undefined
            ? {}
            : { phoneNumberE164: input.phoneNumberE164 }),
          ...(input.phoneNumberId === undefined
            ? {}
            : { phoneNumberId: input.phoneNumberId }),
          ...(input.status === undefined ? {} : { status: input.status }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(whatsappConnections.clinicId, input.clinicId),
            ...(input.preserveDisconnected
              ? [ne(whatsappConnections.status, "disconnected")]
              : []),
          ),
        );
    });
  },

  async withWebhookProvisioningLock({ operation, scope }) {
    return inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${scope}))`,
      );
      return operation();
    });
  },
};

function toProvisioningEvent(
  event: typeof whatsappWebhookEvents.$inferSelect,
  leaseRecovered = false,
): KapsoProvisioningEvent {
  return {
    attempts: event.attempts,
    id: event.id,
    idempotencyKey: event.idempotencyKey,
    leaseExpiresAt: event.leaseExpiresAt,
    leaseRecovered,
    leaseToken: event.leaseToken,
    nextAttemptAt: event.nextAttemptAt,
    payload: event.payload as KapsoPhoneNumberLifecycleEvent,
    receivedAt: event.receivedAt,
    status: event.status,
  };
}

async function isProvisioningEventCircuitOpen(
  transaction: ClinicTransaction,
  payload: unknown,
) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return false;
  }
  const event = payload as Partial<KapsoPhoneNumberLifecycleEvent>;
  if (
    typeof event.customerId !== "string" ||
    typeof event.phoneNumberId !== "string"
  ) {
    return false;
  }
  const connections = await transaction.query.whatsappConnections.findMany({
    columns: { clinicId: true },
    where: or(
      eq(whatsappConnections.customer, event.customerId),
      eq(whatsappConnections.phoneNumberId, event.phoneNumberId),
    ),
  });
  for (const connection of connections) {
    if (
      await isWhatsAppCircuitOpenInTransaction(transaction, connection.clinicId)
    ) {
      return true;
    }
  }
  return false;
}

function toProvisioningConnection(
  connection: typeof whatsappConnections.$inferSelect,
): KapsoProvisioningConnection {
  return {
    businessAccountId: connection.businessAccountId,
    clinicId: connection.clinicId,
    connectionType: connection.connectionType,
    customer: connection.customer,
    metadata: connection.metadata,
    phoneNumberE164: connection.phoneNumberE164,
    phoneNumberId: connection.phoneNumberId,
    provider: connection.provider,
    status: connection.status,
  };
}
