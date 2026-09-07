import { randomUUID } from "node:crypto";

import { and, eq, isNull, lte, ne, or, sql } from "drizzle-orm";

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
} from "~/server/db/clinic-context";
import {
  clinics,
  whatsappConnections,
  whatsappProvisioningSteps,
  whatsappWebhookEvents,
} from "~/server/db/schema";

const PROVISIONING_LEASE_MS = 10 * 60_000;

export const drizzleWhatsAppProvisioningStore: KapsoProvisioningStore = {
  async claimDueEvents({ limit, now }) {
    return inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      const candidates = await transaction
        .select()
        .from(whatsappWebhookEvents)
        .where(
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
        )
        .limit(limit);
      const claimed: KapsoProvisioningEvent[] = [];

      for (const candidate of candidates) {
        const [event] = await transaction
          .update(whatsappWebhookEvents)
          .set({
            attempts: candidate.attempts + 1,
            leaseExpiresAt: new Date(now.valueOf() + PROVISIONING_LEASE_MS),
            leaseToken: randomUUID(),
            status: "processing",
          })
          .where(
            and(
              eq(whatsappWebhookEvents.id, candidate.id),
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
        if (event !== undefined) claimed.push(toProvisioningEvent(event));
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
};

function toProvisioningEvent(
  event: typeof whatsappWebhookEvents.$inferSelect,
): KapsoProvisioningEvent {
  return {
    attempts: event.attempts,
    id: event.id,
    idempotencyKey: event.idempotencyKey,
    leaseToken: event.leaseToken,
    nextAttemptAt: event.nextAttemptAt,
    payload: event.payload as KapsoPhoneNumberLifecycleEvent,
    status: event.status,
  };
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
