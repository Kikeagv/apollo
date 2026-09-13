import { and, asc, eq, gte, lte, sql } from "drizzle-orm";

import {
  defaultWhatsAppCircuitBreakerState,
  evaluateWhatsAppBillingHealth,
  sanitizeWhatsAppOperationalText,
  shouldOpenWhatsAppCircuit,
  whatsappCircuitBreakerFailurePolicy,
  type WhatsAppCircuitBreakerState,
} from "~/domain/whatsapp-circuit-breaker";
import { WHATSAPP_BILLING_RESERVATION_LEASE_MS } from "~/server/application/whatsapp-billing-capacity";
import {
  emptyWhatsAppOperationalMetrics,
  type WhatsAppCircuitBreakerStore,
  type WhatsAppOperationalMetrics,
} from "~/server/application/whatsapp-circuit-breaker";
import {
  inClinicTransaction,
  inAppointmentSchedulerTransaction,
  inSuperadminTransaction,
  inWhatsAppInboundWorkerTransaction,
  inWhatsAppDeliveryStatusWorkerTransaction,
  inWhatsAppOutboundWorkerTransaction,
  inWhatsAppProvisioningWorkerTransaction,
  lockWhatsAppCircuit,
  setWhatsAppWorkerClinicContext,
  type ClinicTransaction,
} from "~/server/db/clinic-context";
import {
  clinics,
  transactionalDeliveries,
  whatsappBilling,
  whatsappBillingReservations,
  whatsappCircuitBreakerAlerts,
  whatsappCircuitBreakerAudits,
  whatsappCircuitBreakers,
  whatsappConnections,
  whatsappInboundReplies,
  whatsappReadiness,
  whatsappUsageMetrics,
} from "~/server/db/schema";
import { publicWhatsAppConnectionMetadata } from "~/domain/whatsapp-connection";

const RETAIN_MS = 365 * 24 * 60 * 60_000;

type WorkerKind = "inbound" | "outbound" | "provisioning" | "delivery-status";

export const drizzleWhatsAppCircuitBreakerStore: WhatsAppCircuitBreakerStore = {
  async read(input) {
    return withCircuitTransaction(
      input.access,
      input.actorIdentityId,
      input.clinicId,
      input.workerKind,
      async (transaction) => {
        const active =
          input.access === "worker"
            ? await setWhatsAppWorkerClinicContext(transaction, input.clinicId)
            : true;
        if (!active && input.access === "worker") {
          return defaultWhatsAppCircuitBreakerState(input.clinicId);
        }
        return readState(transaction, input.clinicId);
      },
    );
  },

  async open(input) {
    const access =
      input.actorKind === "superadmin" ||
      (input.actorKind === undefined &&
        input.actorIdentityId !== null &&
        input.actorIdentityId !== undefined)
        ? "superadmin"
        : "worker";
    return withCircuitTransaction(
      access,
      input.actorIdentityId ?? undefined,
      input.clinicId,
      input.workerKind,
      async (transaction) => {
        if (access === "worker") {
          const active = await setWhatsAppWorkerClinicContext(
            transaction,
            input.clinicId,
          );
          if (!active) throw new Error("La Clínica no está activa");
        } else {
          await setSuperadminClinicContext(transaction, input.clinicId);
        }
        return openWhatsAppCircuitInTransaction(transaction, {
          actorIdentityId: input.actorIdentityId ?? null,
          actorKind:
            input.actorKind ??
            (access === "superadmin" ? "superadmin" : "worker"),
          cause: input.cause,
          clinicId: input.clinicId,
          now: input.now,
          reason: input.reason,
        });
      },
    );
  },

  async recordFailure(input) {
    return withCircuitTransaction(
      "worker",
      undefined,
      input.clinicId,
      input.workerKind,
      async (transaction) => {
        const active = await setWhatsAppWorkerClinicContext(
          transaction,
          input.clinicId,
        );
        if (!active) throw new Error("La Clínica no está activa");
        await lockCircuit(transaction, input.clinicId);
        const current = await readState(transaction, input.clinicId);
        if (current.status === "open") return { opened: false, state: current };

        const windowIsCurrent =
          current.failureWindowStartedAt !== null &&
          input.now.valueOf() - current.failureWindowStartedAt.valueOf() <=
            whatsappCircuitBreakerFailurePolicy.failureWindowMs;
        const failureCount = windowIsCurrent ? current.failureCount + 1 : 1;
        const failureWindowStartedAt = windowIsCurrent
          ? current.failureWindowStartedAt
          : input.now;
        const opened = shouldOpenWhatsAppCircuit({
          failureCount,
          now: input.now,
          windowStartedAt: failureWindowStartedAt,
        });
        const next = {
          ...current,
          cause: opened ? input.cause : current.cause,
          failureCount,
          failureWindowStartedAt,
          lastFailureAt: input.now,
          lastTransitionAt: opened ? input.now : current.lastTransitionAt,
          nextAction: opened
            ? "Corregir la causa y ejecutar una prueba sintética"
            : current.nextAction,
          openedAt: opened ? input.now : current.openedAt,
          reason: opened
            ? sanitizeWhatsAppOperationalText(input.reason)
            : current.reason,
          revision: current.revision + 1,
          status: opened ? ("open" as const) : current.status,
          updatedAt: input.now,
        };
        await upsertState(transaction, next);
        await appendAudit(transaction, {
          action: opened ? "opened" : "failure-recorded",
          actorIdentityId: null,
          actorKind: "worker",
          clinicId: input.clinicId,
          cause: input.cause,
          fromStatus: current.status,
          occurredAt: input.now,
          reason: sanitizeWhatsAppOperationalText(input.reason),
          toStatus: next.status,
        });
        if (opened) {
          await blockConnection(
            transaction,
            input.clinicId,
            next.reason,
            input.now,
          );
          await upsertCircuitBreakerAlert(transaction, {
            cause: input.cause,
            clinicId: input.clinicId,
            nextAction: next.nextAction,
            now: input.now,
            reason: next.reason,
          });
        }
        return { opened, state: next };
      },
    );
  },

  async recordSyntheticTest(input) {
    return withCircuitTransaction(
      "superadmin",
      input.actorIdentityId ?? undefined,
      input.clinicId,
      undefined,
      async (transaction) => {
        await setSuperadminClinicContext(transaction, input.clinicId);
        await lockCircuit(transaction, input.clinicId);
        const current = await readState(transaction, input.clinicId);
        if (current.status !== "open") {
          throw new Error("La Conexión no tiene un circuito abierto");
        }
        if (
          input.expectedRevision !== undefined &&
          current.revision !== input.expectedRevision
        ) {
          throw new Error(
            "El circuito cambió mientras se ejecutaba la prueba sintética; vuelva a intentarlo",
          );
        }
        const next = {
          ...current,
          lastSyntheticEvidence: sanitizeWhatsAppOperationalText(
            input.evidence,
          ),
          lastSyntheticTestAt: input.now,
          lastSyntheticTestStatus: input.passed
            ? ("passed" as const)
            : ("failed" as const),
          revision: current.revision + 1,
          updatedAt: input.now,
        };
        await upsertState(transaction, next);
        await appendAudit(transaction, {
          action: "synthetic-test",
          actorIdentityId: input.actorIdentityId ?? null,
          actorKind: "superadmin",
          clinicId: input.clinicId,
          fromStatus: current.status,
          occurredAt: input.now,
          reason: input.passed
            ? "La prueba sintética terminó correctamente"
            : "La prueba sintética falló",
          toStatus: current.status,
          evidence: sanitizeWhatsAppOperationalText(input.evidence),
        });
        return next;
      },
    );
  },

  async reactivate(input) {
    return withCircuitTransaction(
      "superadmin",
      input.actorIdentityId,
      input.clinicId,
      undefined,
      async (transaction) => {
        await setSuperadminClinicContext(transaction, input.clinicId);
        await lockCircuit(transaction, input.clinicId);
        const current = await readState(transaction, input.clinicId);
        if (current.status !== "open") {
          throw new Error("La Conexión no tiene un circuito abierto");
        }
        if (
          input.expectedRevision !== undefined &&
          current.revision !== input.expectedRevision
        ) {
          throw new Error(
            "El circuito cambió mientras se validaba la reactivación; vuelva a intentarlo",
          );
        }
        if (
          input.expectedSyntheticTestAt !== undefined &&
          (current.lastSyntheticTestStatus !== "passed" ||
            current.lastSyntheticTestAt?.valueOf() !==
              input.expectedSyntheticTestAt?.valueOf())
        ) {
          throw new Error(
            "La prueba sintética ya no es la evidencia vigente para reactivar la Conexión",
          );
        }
        const [connection] = await transaction
          .select({
            metadata: whatsappConnections.metadata,
            phoneNumberId: whatsappConnections.phoneNumberId,
            status: whatsappConnections.status,
            updatedAt: whatsappConnections.updatedAt,
          })
          .from(whatsappConnections)
          .where(eq(whatsappConnections.clinicId, input.clinicId))
          .for("update");
        const [readiness] = await transaction
          .select({
            phoneNumberId: whatsappReadiness.phoneNumberId,
            projectWebhookId: whatsappReadiness.projectWebhookId,
            provisioningEventId: whatsappReadiness.provisioningEventId,
            revision: whatsappReadiness.revision,
          })
          .from(whatsappReadiness)
          .where(eq(whatsappReadiness.clinicId, input.clinicId))
          .for("update");
        if (
          connection === undefined ||
          readiness === undefined ||
          connection.status !== "blocked" ||
          connection.phoneNumberId !== input.expectedConnection.phoneNumberId ||
          connection.updatedAt.valueOf() !==
            input.expectedConnection.connectionUpdatedAt.valueOf() ||
          connection.metadata.provisioningEventId !==
            input.expectedConnection.provisioningEventId ||
          readiness.phoneNumberId !== input.expectedConnection.phoneNumberId ||
          readiness.projectWebhookId !==
            input.expectedConnection.projectWebhookId ||
          readiness.provisioningEventId !==
            input.expectedConnection.provisioningEventId ||
          readiness.revision !== input.expectedConnection.readinessRevision
        ) {
          throw new Error(
            "La Conexión cambió mientras se validaba la reactivación; vuelva a ejecutar la prueba sintética",
          );
        }
        const next = {
          ...current,
          cause: null,
          failureCount: 0,
          failureWindowStartedAt: null,
          lastReactivatedAt: input.now,
          lastReactivatedByIdentityId: input.actorIdentityId,
          lastTransitionAt: input.now,
          nextAction: "La Conexión opera normalmente",
          openedAt: null,
          reason: "Circuito reactivado manualmente",
          revision: current.revision + 1,
          status: "closed" as const,
          updatedAt: input.now,
        };
        await upsertState(transaction, next);
        await reopenConnection(transaction, input.clinicId, input.now);
        await resolveCircuitBreakerAlert(
          transaction,
          input.clinicId,
          input.now,
        );
        await appendAudit(transaction, {
          action: "reactivated",
          actorIdentityId: input.actorIdentityId,
          actorKind: "superadmin",
          clinicId: input.clinicId,
          fromStatus: current.status,
          occurredAt: input.now,
          reason: next.reason,
          toStatus: next.status,
          evidence: current.lastSyntheticEvidence,
        });
        return next;
      },
    );
  },

  async recordMetric(input) {
    return withCircuitTransaction(
      "worker",
      undefined,
      input.clinicId,
      input.workerKind,
      async (transaction) => {
        const active = await setWhatsAppWorkerClinicContext(
          transaction,
          input.clinicId,
        );
        if (!active) throw new Error("La Clínica no está activa");
        await transaction
          .insert(whatsappUsageMetrics)
          .values({
            category: input.metric.category,
            clinicId: input.clinicId,
            direction: input.metric.direction,
            errorCode: input.errorCode?.slice(0, 120) ?? null,
            idempotencyKey: input.idempotencyKey,
            latencyMs:
              input.latencyMs === null || input.latencyMs === undefined
                ? null
                : Math.max(0, Math.round(input.latencyMs)),
            metaChargesCents: Math.max(0, input.metaChargesCents ?? 0),
            occurredAt: input.occurredAt,
            operation: input.operation,
            outcome: input.outcome,
            platformChargesCents: Math.max(0, input.platformChargesCents ?? 0),
            retainUntil: new Date(input.occurredAt.valueOf() + RETAIN_MS),
            templateName: input.templateName?.slice(0, 160) ?? null,
          })
          .onConflictDoNothing({
            target: [
              whatsappUsageMetrics.clinicId,
              whatsappUsageMetrics.idempotencyKey,
            ],
          });
      },
    );
  },

  async readMetrics(input) {
    return withCircuitTransaction(
      "superadmin",
      input.actorIdentityId,
      input.clinicId,
      undefined,
      async (transaction) => {
        const conditions = [eq(whatsappUsageMetrics.clinicId, input.clinicId)];
        if (input.from !== undefined) {
          conditions.push(gte(whatsappUsageMetrics.occurredAt, input.from));
        }
        if (input.to !== undefined) {
          conditions.push(lte(whatsappUsageMetrics.occurredAt, input.to));
        }
        const rows = await transaction
          .select()
          .from(whatsappUsageMetrics)
          .where(and(...conditions))
          .orderBy(asc(whatsappUsageMetrics.occurredAt));
        return aggregateMetrics(rows);
      },
    );
  },
};

export async function isWhatsAppCircuitOpenInTransaction(
  transaction: ClinicTransaction,
  clinicId: string,
) {
  const active = await setWhatsAppWorkerClinicContext(transaction, clinicId);
  if (!active) return false;
  const state = await readState(transaction, clinicId);
  return state.status === "open";
}

/** Retira únicamente evidencia operacional que ya superó su retención. */
export async function purgeExpiredWhatsAppOperationalData(input: {
  now: Date;
}) {
  return inAppointmentSchedulerTransaction(async (transaction) => {
    const reconciledReservations =
      await reconcileExpiredBillingReservationsInTransaction(
        transaction,
        input.now,
      );
    const [audits, metrics, reservations] = await Promise.all([
      transaction
        .delete(whatsappCircuitBreakerAudits)
        .where(lte(whatsappCircuitBreakerAudits.retainUntil, input.now))
        .returning({ id: whatsappCircuitBreakerAudits.id }),
      transaction
        .delete(whatsappUsageMetrics)
        .where(lte(whatsappUsageMetrics.retainUntil, input.now))
        .returning({ id: whatsappUsageMetrics.id }),
      transaction
        .delete(whatsappBillingReservations)
        .where(
          and(
            lte(whatsappBillingReservations.retainUntil, input.now),
            sql`${whatsappBillingReservations.status} <> 'reserved'`,
          ),
        )
        .returning({ id: whatsappBillingReservations.id }),
    ]);
    return {
      ...reconciledReservations,
      purgedWhatsAppAudits: audits.length,
      purgedWhatsAppMetrics: metrics.length,
      purgedWhatsAppReservations: reservations.length,
    };
  });
}

async function reconcileExpiredBillingReservationsInTransaction(
  transaction: ClinicTransaction,
  now: Date,
) {
  const staleBefore = new Date(
    now.valueOf() - WHATSAPP_BILLING_RESERVATION_LEASE_MS,
  );
  const reservations = await transaction
    .select()
    .from(whatsappBillingReservations)
    .where(
      and(
        eq(whatsappBillingReservations.status, "reserved"),
        lte(whatsappBillingReservations.reservedAt, staleBefore),
      ),
    )
    .for("update");
  let reconciled = 0;
  let released = 0;
  for (const reservation of reservations) {
    const outcome = await findReservationOutcome(transaction, reservation);
    await settleExpiredReservation(transaction, reservation, outcome, now);
    if (outcome === null) released += 1;
    else reconciled += 1;
  }
  return {
    reconciledWhatsAppReservations: reconciled,
    releasedWhatsAppReservations: released,
  };
}

async function findReservationOutcome(
  transaction: ClinicTransaction,
  reservation: typeof whatsappBillingReservations.$inferSelect,
) {
  const [delivery] = await transaction
    .select({ status: transactionalDeliveries.status })
    .from(transactionalDeliveries)
    .where(
      and(
        eq(transactionalDeliveries.clinicId, reservation.clinicId),
        eq(transactionalDeliveries.idempotencyKey, reservation.reservationKey),
      ),
    )
    .limit(1);
  if (delivery !== undefined) return capacityOutcomeFromStatus(delivery.status);

  const [reply] = await transaction
    .select({ status: whatsappInboundReplies.status })
    .from(whatsappInboundReplies)
    .where(
      and(
        eq(whatsappInboundReplies.clinicId, reservation.clinicId),
        eq(whatsappInboundReplies.idempotencyKey, reservation.reservationKey),
      ),
    )
    .limit(1);
  if (reply !== undefined) return capacityOutcomeFromStatus(reply.status);
  return null;
}

function capacityOutcomeFromStatus(status: string) {
  if (status === "accepted") return "accepted" as const;
  if (status === "sent" || status === "delivered" || status === "read") {
    return "delivered" as const;
  }
  // Una reserva vencida con un outbox conocido se conserva como consumo
  // desconocido: así una caída entre Kapso y la liquidación no libera
  // capacidad que pudiera ya haber sido utilizada.
  return "unknown" as const;
}

async function settleExpiredReservation(
  transaction: ClinicTransaction,
  reservation: typeof whatsappBillingReservations.$inferSelect,
  outcome: "accepted" | "delivered" | "failed" | "unknown" | null,
  now: Date,
) {
  const [billing] = await transaction
    .select()
    .from(whatsappBilling)
    .where(eq(whatsappBilling.clinicId, reservation.clinicId))
    .for("update");
  const consumesCapacity = outcome !== null;
  if (billing !== undefined) {
    await transaction
      .update(whatsappBilling)
      .set({
        creditCents: consumesCapacity
          ? sql`greatest(0, ${whatsappBilling.creditCents} - ${reservation.creditCents})`
          : undefined,
        creditInFlightCents: sql`greatest(0, ${whatsappBilling.creditInFlightCents} - ${reservation.creditCents})`,
        consumedCents: consumesCapacity
          ? sql`${whatsappBilling.consumedCents} + ${reservation.creditCents}`
          : undefined,
        kapsoQuotaConsumed: consumesCapacity
          ? sql`${whatsappBilling.kapsoQuotaConsumed} + ${reservation.quotaUnits}`
          : undefined,
        kapsoQuotaInFlight: sql`greatest(0, ${whatsappBilling.kapsoQuotaInFlight} - ${reservation.quotaUnits})`,
        updatedAt: now,
      })
      .where(eq(whatsappBilling.clinicId, reservation.clinicId));
  }
  await transaction
    .update(whatsappBillingReservations)
    .set({
      outcome: outcome ?? "failed",
      settledAt: now,
      status: consumesCapacity ? "settled" : "released",
    })
    .where(eq(whatsappBillingReservations.id, reservation.id));
}

/** Abre el circuito dentro de la transacción que ya comprobó la causa. */
export async function openWhatsAppCircuitInTransaction(
  transaction: ClinicTransaction,
  input: {
    actorIdentityId?: string | null;
    actorKind: "superadmin" | "system" | "worker";
    cause: Parameters<WhatsAppCircuitBreakerStore["open"]>[0]["cause"];
    clinicId: string;
    now: Date;
    reason: string;
  },
) {
  await lockCircuit(transaction, input.clinicId);
  const current = await readState(transaction, input.clinicId);
  if (current.status === "open") return current;

  const next = {
    ...current,
    cause: input.cause,
    lastTransitionAt: input.now,
    nextAction: "Corregir la causa y ejecutar una prueba sintética",
    openedAt: input.now,
    reason: sanitizeWhatsAppOperationalText(input.reason),
    revision: current.revision + 1,
    status: "open" as const,
    updatedAt: input.now,
  };
  await upsertState(transaction, next);
  await blockConnection(transaction, input.clinicId, next.reason, input.now);
  await upsertCircuitBreakerAlert(transaction, {
    cause: input.cause,
    clinicId: input.clinicId,
    nextAction: next.nextAction,
    now: input.now,
    reason: next.reason,
  });
  await appendAudit(transaction, {
    action: "opened",
    actorIdentityId: input.actorIdentityId ?? null,
    actorKind: input.actorKind,
    clinicId: input.clinicId,
    cause: input.cause,
    fromStatus: current.status,
    occurredAt: input.now,
    reason: next.reason,
    toStatus: next.status,
  });
  return next;
}

async function withCircuitTransaction<T>(
  access: "clinic-owner" | "superadmin" | "worker",
  actorIdentityId: string | undefined,
  clinicId: string,
  workerKind: WorkerKind | undefined,
  operation: (transaction: ClinicTransaction) => Promise<T>,
) {
  if (access === "superadmin") {
    if (actorIdentityId === undefined) {
      throw new Error("La operación requiere una Identidad de superadmin");
    }
    return inSuperadminTransaction(actorIdentityId, operation);
  }
  if (access === "clinic-owner") {
    if (actorIdentityId === undefined) {
      throw new Error("La operación requiere una Identidad de Clínica");
    }
    return inClinicTransaction(
      { clinicId, identityId: actorIdentityId },
      operation,
    );
  }
  if (workerKind === "inbound") {
    return inWhatsAppInboundWorkerTransaction(operation);
  }
  if (workerKind === "provisioning") {
    return inWhatsAppProvisioningWorkerTransaction(operation);
  }
  if (workerKind === "delivery-status") {
    return inWhatsAppDeliveryStatusWorkerTransaction(operation);
  }
  return inWhatsAppOutboundWorkerTransaction(operation);
}

async function setSuperadminClinicContext(
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
}

async function lockCircuit(transaction: ClinicTransaction, clinicId: string) {
  await lockWhatsAppCircuit(transaction, clinicId);
}

async function readState(
  transaction: ClinicTransaction,
  clinicId: string,
): Promise<WhatsAppCircuitBreakerState> {
  const row = await transaction.query.whatsappCircuitBreakers.findFirst({
    where: eq(whatsappCircuitBreakers.clinicId, clinicId),
  });
  return row === undefined
    ? defaultWhatsAppCircuitBreakerState(clinicId)
    : toState(row);
}

async function upsertState(
  transaction: ClinicTransaction,
  state: WhatsAppCircuitBreakerState,
) {
  await transaction
    .insert(whatsappCircuitBreakers)
    .values({
      cause: state.cause,
      clinicId: state.clinicId,
      failureCount: state.failureCount,
      failureWindowStartedAt: state.failureWindowStartedAt,
      lastFailureAt: state.lastFailureAt,
      lastReactivatedAt: state.lastReactivatedAt,
      lastReactivatedByIdentityId: state.lastReactivatedByIdentityId,
      lastSyntheticEvidence: state.lastSyntheticEvidence,
      lastSyntheticTestAt: state.lastSyntheticTestAt,
      lastSyntheticTestStatus: state.lastSyntheticTestStatus,
      lastTransitionAt: state.lastTransitionAt,
      nextAction: state.nextAction,
      openedAt: state.openedAt,
      reason: state.reason,
      revision: state.revision,
      status: state.status,
      updatedAt: state.updatedAt,
    })
    .onConflictDoUpdate({
      target: whatsappCircuitBreakers.clinicId,
      set: {
        cause: state.cause,
        failureCount: state.failureCount,
        failureWindowStartedAt: state.failureWindowStartedAt,
        lastFailureAt: state.lastFailureAt,
        lastReactivatedAt: state.lastReactivatedAt,
        lastReactivatedByIdentityId: state.lastReactivatedByIdentityId,
        lastSyntheticEvidence: state.lastSyntheticEvidence,
        lastSyntheticTestAt: state.lastSyntheticTestAt,
        lastSyntheticTestStatus: state.lastSyntheticTestStatus,
        lastTransitionAt: state.lastTransitionAt,
        nextAction: state.nextAction,
        openedAt: state.openedAt,
        reason: state.reason,
        revision: state.revision,
        status: state.status,
        updatedAt: state.updatedAt,
      },
    });
}

async function blockConnection(
  transaction: ClinicTransaction,
  clinicId: string,
  reason: string,
  now: Date,
) {
  const connection = await transaction.query.whatsappConnections.findFirst({
    where: eq(whatsappConnections.clinicId, clinicId),
  });
  if (connection === undefined || connection.status === "disconnected") return;
  await transaction
    .update(whatsappConnections)
    .set({
      metadata: publicWhatsAppConnectionMetadata({
        ...connection.metadata,
        nextAction: "Corregir la causa y reactivar manualmente la Conexión",
        statusReason: reason,
      }),
      status: "blocked",
      updatedAt: now,
    })
    .where(eq(whatsappConnections.clinicId, clinicId));
}

async function reopenConnection(
  transaction: ClinicTransaction,
  clinicId: string,
  now: Date,
) {
  const connection = await transaction.query.whatsappConnections.findFirst({
    where: eq(whatsappConnections.clinicId, clinicId),
  });
  if (connection === undefined || connection.status === "disconnected") return;
  await transaction
    .update(whatsappConnections)
    .set({
      metadata: publicWhatsAppConnectionMetadata({
        ...connection.metadata,
        nextAction: "Conexión lista",
        statusReason: "Circuito reactivado manualmente",
      }),
      status: "ready",
      updatedAt: now,
    })
    .where(eq(whatsappConnections.clinicId, clinicId));
}

async function upsertCircuitBreakerAlert(
  transaction: ClinicTransaction,
  input: {
    cause: NonNullable<WhatsAppCircuitBreakerState["cause"]>;
    clinicId: string;
    nextAction: string;
    now: Date;
    reason: string;
  },
) {
  await transaction
    .insert(whatsappCircuitBreakerAlerts)
    .values({
      cause: input.cause,
      clinicId: input.clinicId,
      nextAction: sanitizeWhatsAppOperationalText(input.nextAction),
      openedAt: input.now,
      reason: sanitizeWhatsAppOperationalText(input.reason),
      status: "open",
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: whatsappCircuitBreakerAlerts.clinicId,
      set: {
        cause: input.cause,
        nextAction: sanitizeWhatsAppOperationalText(input.nextAction),
        openedAt: input.now,
        reason: sanitizeWhatsAppOperationalText(input.reason),
        resolvedAt: null,
        status: "open",
        updatedAt: input.now,
      },
    });
}

async function resolveCircuitBreakerAlert(
  transaction: ClinicTransaction,
  clinicId: string,
  now: Date,
) {
  await transaction
    .update(whatsappCircuitBreakerAlerts)
    .set({ resolvedAt: now, status: "resolved", updatedAt: now })
    .where(eq(whatsappCircuitBreakerAlerts.clinicId, clinicId));
}

async function appendAudit(
  transaction: ClinicTransaction,
  input: {
    action: "failure-recorded" | "opened" | "synthetic-test" | "reactivated";
    actorIdentityId: string | null;
    actorKind: "superadmin" | "system" | "worker";
    cause?: WhatsAppCircuitBreakerState["cause"];
    clinicId: string;
    evidence?: string | null;
    fromStatus: WhatsAppCircuitBreakerState["status"] | null;
    occurredAt?: Date;
    reason: string;
    toStatus: WhatsAppCircuitBreakerState["status"];
  },
) {
  const occurredAt = input.occurredAt ?? new Date();
  await transaction.insert(whatsappCircuitBreakerAudits).values({
    action: input.action,
    actorIdentityId: input.actorIdentityId,
    actorKind: input.actorKind,
    cause: input.cause ?? null,
    clinicId: input.clinicId,
    evidence:
      input.evidence === null || input.evidence === undefined
        ? null
        : sanitizeWhatsAppOperationalText(input.evidence),
    fromStatus: input.fromStatus,
    occurredAt,
    reason: sanitizeWhatsAppOperationalText(input.reason),
    retainUntil: new Date(occurredAt.valueOf() + RETAIN_MS),
    toStatus: input.toStatus,
  });
}

function toState(
  row: typeof whatsappCircuitBreakers.$inferSelect,
): WhatsAppCircuitBreakerState {
  return {
    clinicId: row.clinicId,
    cause: row.cause,
    failureCount: row.failureCount,
    failureWindowStartedAt: row.failureWindowStartedAt,
    lastFailureAt: row.lastFailureAt,
    lastReactivatedAt: row.lastReactivatedAt,
    lastReactivatedByIdentityId: row.lastReactivatedByIdentityId,
    lastSyntheticEvidence: row.lastSyntheticEvidence,
    lastSyntheticTestAt: row.lastSyntheticTestAt,
    lastSyntheticTestStatus: row.lastSyntheticTestStatus,
    lastTransitionAt: row.lastTransitionAt,
    nextAction: row.nextAction,
    openedAt: row.openedAt,
    reason: row.reason,
    revision: row.revision,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

function aggregateMetrics(
  rows: Array<typeof whatsappUsageMetrics.$inferSelect>,
): WhatsAppOperationalMetrics {
  const result = emptyWhatsAppOperationalMetrics();
  const templates = new Map<string, { attempted: number; failed: number }>();
  for (const row of rows) {
    const isReadReceipt = row.category === "read-receipt";
    const isDeliveryStatus = row.operation === "transactional-delivery-status";
    if (!isDeliveryStatus) {
      if (row.direction === "inbound") {
        result.inboundMessages += isReadReceipt ? 0 : 1;
      }
      if (row.direction === "outbound") {
        result.outboundMessages += isReadReceipt ? 0 : 1;
      }
      if (!isReadReceipt) result.quotaMessages += 1;
      if (row.category === "media") result.mediaMessages += 1;
      if (row.category === "template") result.templateMessages += 1;
      if (row.category === "interactive") result.interactiveMessages += 1;
      if (row.category === "reaction") result.reactionMessages += 1;
    }
    if (isReadReceipt) result.readReceipts += 1;
    if (row.outcome === "failed" || row.outcome === "unknown")
      result.errors += 1;
    if (row.latencyMs !== null) result.totalLatencyMs += row.latencyMs;
    if (!isReadReceipt) {
      result.metaChargesCents += row.metaChargesCents;
      result.platformChargesCents += row.platformChargesCents;
    }
    if (row.operation === "transactional-delivery") {
      result.deliveries.attempted += 1;
      if (row.outcome === "accepted") result.deliveries.accepted += 1;
      if (row.outcome === "delivered") result.deliveries.delivered += 1;
      if (row.outcome === "failed") result.deliveries.failed += 1;
      if (row.outcome === "unknown") result.deliveries.unknown += 1;
    }
    if (row.operation === "transactional-delivery-status") {
      if (row.outcome === "delivered") result.deliveries.delivered += 1;
      if (row.outcome === "failed") result.deliveries.failed += 1;
      if (row.outcome === "unknown") result.deliveries.unknown += 1;
    }
    if (row.templateName !== null && !isDeliveryStatus) {
      const template = templates.get(row.templateName) ?? {
        attempted: 0,
        failed: 0,
      };
      template.attempted += 1;
      if (row.outcome === "failed" || row.outcome === "unknown")
        template.failed += 1;
      templates.set(row.templateName, template);
    }
  }
  result.templates = [...templates.entries()]
    .map(([name, values]) => ({ name, ...values }))
    .sort((left, right) => left.name.localeCompare(right.name));
  result.averageLatencyMs =
    rows.filter((row) => row.latencyMs !== null).length === 0
      ? null
      : Math.round(
          result.totalLatencyMs /
            rows.filter((row) => row.latencyMs !== null).length,
        );
  return result;
}

export function billingHealthFromSnapshot(input: {
  creditCents: number;
  creditLimitCents: number | null;
  estimatedDailyConsumptionCents: number;
  warningBalancePercent: number;
  criticalBalancePercent: number;
  warningAutonomyDays: number;
  criticalAutonomyDays: number;
}) {
  return evaluateWhatsAppBillingHealth(input);
}
