import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  WhatsAppReadinessConflictError,
  type WhatsAppReadinessAlertSyncInput,
  type WhatsAppReadinessRecord,
  type WhatsAppReadinessProvisioningStore,
  type WhatsAppReadinessReconciliationStore,
  type WhatsAppReadinessStore,
} from "~/server/application/whatsapp-readiness";
import { publicWhatsAppConnectionMetadata } from "~/domain/whatsapp-connection";
import {
  getWhatsAppReadinessGeneration,
  isSameWhatsAppReadinessGeneration,
  whatsappCriticalTemplateCatalog,
  type WhatsAppTemplateProvisioningStatus,
  type WhatsAppTemplateSnapshot,
} from "~/domain/whatsapp-readiness";
import {
  isWhatsAppOperationalFailure,
  type WhatsAppConnectionAlert,
} from "~/domain/whatsapp-connection-alert";
import { reconcileWhatsAppQuotaConsumption } from "~/domain/whatsapp-circuit-breaker";
import {
  inClinicTransaction,
  inWhatsAppProvisioningWorkerTransaction,
  inSuperadminTransaction,
  lockWhatsAppCircuit,
  type ClinicTransaction,
} from "~/server/db/clinic-context";
import {
  clinics,
  clinicUsers,
  whatsappBilling,
  whatsappCircuitBreakers,
  whatsappConnections,
  whatsappConnectionAlerts,
  whatsappCriticalTemplates,
  whatsappProvisioningSteps,
  whatsappReadiness,
  whatsappWebhookEvents,
} from "~/server/db/schema";

export const drizzleWhatsAppReadinessStore: WhatsAppReadinessStore &
  WhatsAppReadinessProvisioningStore &
  WhatsAppReadinessReconciliationStore = {
  async read(input) {
    const operation = async (transaction: ClinicTransaction) => {
      if (input.access === "clinic-owner") {
        const owner = await transaction.query.clinicUsers.findFirst({
          columns: { id: true },
          where: and(
            eq(clinicUsers.clinicId, input.clinicId),
            eq(clinicUsers.identityId, input.actorIdentityId),
            eq(clinicUsers.active, true),
            eq(clinicUsers.role, "owner"),
          ),
        });
        if (owner === undefined) {
          throw new Error("Solo el Médico propietario puede ver readiness");
        }
      }
      return readRecord(
        transaction,
        input.clinicId,
        input.access === "superadmin",
      );
    };

    if (input.access === "clinic-owner") {
      return inClinicTransaction(
        { clinicId: input.clinicId, identityId: input.actorIdentityId },
        operation,
      );
    }
    return inSuperadminTransaction(input.actorIdentityId, operation);
  },

  async withTemplateProvisioningLock({ businessAccountId, operation }) {
    return inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${"whatsapp-templates:" + businessAccountId}))`,
      );
      return operation();
    });
  },

  async readForProvisioning(input) {
    return inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      await assertActiveProvisioningLease(
        transaction,
        input.eventId,
        input.leaseToken,
        input.now,
      );
      await setProvisioningClinicId(transaction, input.clinicId);
      const clinic = await transaction.query.clinics.findFirst({
        columns: { subscriptionStatus: true },
        where: eq(clinics.id, input.clinicId),
      });
      if (clinic === undefined) throw new Error("La Clínica no existe");
      await setProvisioningClinicContext(
        transaction,
        input.clinicId,
        clinic.subscriptionStatus,
      );
      const state = await readRecord(transaction, input.clinicId, false);
      if (
        state.connection?.phoneNumberId !== input.phoneNumberId ||
        state.projectId !== input.projectId ||
        state.provisioningEventId !== input.eventId
      ) {
        throw new WhatsAppReadinessConflictError();
      }
      return state;
    });
  },

  async claimDueReconciliations({ limit, now }) {
    const leaseExpiresAt = new Date(now.valueOf() + 10 * 60_000);
    return inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      const candidates = await transaction
        .select({ clinicId: whatsappConnections.clinicId })
        .from(whatsappConnections)
        .where(
          and(
            eq(whatsappConnections.provider, "kapso"),
            inArray(whatsappConnections.status, [
              "pending",
              "provisioning",
              "degraded",
              "ready",
            ]),
          ),
        )
        .limit(Math.max(limit * 4, limit));
      const claimed = [];
      for (const candidate of candidates) {
        if (claimed.length >= limit) break;
        await setProvisioningClinicId(transaction, candidate.clinicId);
        await lockWhatsAppCircuit(transaction, candidate.clinicId);
        const clinic = await transaction.query.clinics.findFirst({
          columns: { subscriptionStatus: true },
          where: eq(clinics.id, candidate.clinicId),
        });
        if (clinic?.subscriptionStatus !== "active") continue;
        let readiness = await transaction.query.whatsappReadiness.findFirst({
          where: eq(whatsappReadiness.clinicId, candidate.clinicId),
        });
        if (readiness === undefined) {
          const initial = await readRecord(
            transaction,
            candidate.clinicId,
            false,
          );
          await transaction
            .insert(whatsappReadiness)
            .values(toReadinessRow(initial))
            .onConflictDoNothing({ target: whatsappReadiness.clinicId });
          readiness = await transaction.query.whatsappReadiness.findFirst({
            where: eq(whatsappReadiness.clinicId, candidate.clinicId),
          });
        }
        if (readiness === undefined) continue;
        const [claimedRow] = await transaction
          .update(whatsappReadiness)
          .set({
            reconciliationAttempts: sql`${whatsappReadiness.reconciliationAttempts} + 1`,
            reconciliationLastAttemptAt: now,
            reconciliationLeaseExpiresAt: leaseExpiresAt,
            reconciliationLeaseToken: randomUUID(),
            reconciliationStatus: "processing",
          })
          .where(
            and(
              eq(whatsappReadiness.clinicId, candidate.clinicId),
              or(
                and(
                  inArray(whatsappReadiness.reconciliationStatus, [
                    "pending",
                    "succeeded",
                  ]),
                  or(
                    isNull(whatsappReadiness.reconciliationNextAttemptAt),
                    lte(whatsappReadiness.reconciliationNextAttemptAt, now),
                  ),
                ),
                and(
                  eq(whatsappReadiness.reconciliationStatus, "processing"),
                  lte(whatsappReadiness.reconciliationLeaseExpiresAt, now),
                ),
              ),
            ),
          )
          .returning({
            attempts: whatsappReadiness.reconciliationAttempts,
            leaseToken: whatsappReadiness.reconciliationLeaseToken,
          });
        if (claimedRow?.leaseToken == null) {
          continue;
        }
        const connection =
          await transaction.query.whatsappConnections.findFirst({
            where: eq(whatsappConnections.clinicId, candidate.clinicId),
          });
        if (connection === undefined) continue;
        claimed.push({
          attempts: claimedRow.attempts,
          claimedGeneration: getWhatsAppReadinessGeneration(connection),
          clinicId: candidate.clinicId,
          expectedGeneration: getWhatsAppReadinessGeneration(connection),
          leaseToken: claimedRow.leaseToken,
        });
      }
      return claimed;
    });
  },

  async readForReconciliation(input) {
    return inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      await setProvisioningClinicId(transaction, input.clinicId);
      await assertActiveReconciliationLease(
        transaction,
        input.clinicId,
        input.leaseToken,
        input.now,
      );
      const clinic = await transaction.query.clinics.findFirst({
        columns: { subscriptionStatus: true },
        where: eq(clinics.id, input.clinicId),
      });
      if (clinic === undefined) throw new Error("La Clínica no existe");
      await setProvisioningClinicContext(
        transaction,
        input.clinicId,
        clinic.subscriptionStatus,
      );
      await setReconciliationContext(transaction, input.leaseToken);
      return readRecord(transaction, input.clinicId, false);
    });
  },

  async saveForReconciliation(input) {
    if (input.state.clinicId !== input.clinicId) {
      throw new Error("El estado de readiness no pertenece a la Clínica");
    }
    if (input.state.connection === null) {
      throw new WhatsAppReadinessConflictError();
    }
    if (
      !isSameWhatsAppReadinessGeneration(
        input.expectedGeneration,
        getWhatsAppReadinessGeneration(input.state.connection),
      )
    ) {
      throw new WhatsAppReadinessConflictError();
    }
    return inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      await setProvisioningClinicId(transaction, input.clinicId);
      await assertActiveReconciliationLease(
        transaction,
        input.clinicId,
        input.leaseToken,
        input.now,
      );
      await setProvisioningClinicContextForWorker(transaction, input.clinicId);
      await setReconciliationContext(transaction, input.leaseToken);
      await lockWhatsAppCircuit(transaction, input.clinicId);
      const [persistedConnection] = await transaction
        .select()
        .from(whatsappConnections)
        .where(eq(whatsappConnections.clinicId, input.clinicId))
        .for("update");
      if (
        persistedConnection === undefined ||
        !isSameWhatsAppReadinessGeneration(
          input.claimedGeneration,
          getWhatsAppReadinessGeneration(persistedConnection),
        )
      ) {
        throw new WhatsAppReadinessConflictError();
      }
      const stateConnection = input.state.connection;
      if (stateConnection === null) {
        throw new WhatsAppReadinessConflictError();
      }
      await transaction
        .update(whatsappConnections)
        .set({
          businessAccountId: stateConnection.businessAccountId,
          lastTestAt: stateConnection.lastTestAt,
          metadata: mergeOperationalMetadata(
            persistedConnection.metadata,
            stateConnection.metadata,
          ),
          phoneNumberE164: stateConnection.phoneNumberE164,
          phoneNumberId: stateConnection.phoneNumberId,
          status: (await isCircuitOpen(transaction, input.clinicId))
            ? "blocked"
            : stateConnection.status,
          updatedAt: stateConnection.updatedAt,
        })
        .where(eq(whatsappConnections.clinicId, input.clinicId));
      await persistReadinessState(transaction, input.state);
      return readRecord(transaction, input.clinicId, false);
    });
  },

  async completeReconciliation(input) {
    await inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      await setProvisioningClinicId(transaction, input.clinicId);
      await assertActiveReconciliationLease(
        transaction,
        input.clinicId,
        input.leaseToken,
        input.now,
      );
      await setReconciliationContext(transaction, input.leaseToken);
      await lockWhatsAppCircuit(transaction, input.clinicId);
      await transaction
        .update(whatsappReadiness)
        .set({
          reconciliationAttempts: input.attempts ?? 0,
          reconciliationLastError: input.lastError?.slice(0, 1_000) ?? null,
          reconciliationNextAttemptAt: input.nextAttemptAt,
          reconciliationStatus: input.status,
          reconciliationLeaseExpiresAt: null,
          reconciliationLeaseToken: null,
        })
        .where(
          and(
            eq(whatsappReadiness.clinicId, input.clinicId),
            eq(whatsappReadiness.reconciliationLeaseToken, input.leaseToken),
          ),
        );
    });
  },

  async retryWebhooks(input) {
    await inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        const connection =
          await transaction.query.whatsappConnections.findFirst({
            where: eq(whatsappConnections.clinicId, input.clinicId),
          });
        if (
          connection === undefined ||
          !isSameWhatsAppReadinessGeneration(
            input.expectedGeneration,
            getWhatsAppReadinessGeneration(connection),
          )
        ) {
          throw new WhatsAppReadinessConflictError();
        }

        const [event] = await transaction
          .select({
            leaseExpiresAt: whatsappWebhookEvents.leaseExpiresAt,
            status: whatsappWebhookEvents.status,
          })
          .from(whatsappWebhookEvents)
          .where(
            and(
              eq(whatsappWebhookEvents.id, input.eventId),
              eq(
                whatsappWebhookEvents.eventName,
                "whatsapp.phone_number.created",
              ),
            ),
          )
          .for("update");
        if (event === undefined) {
          throw new WhatsAppReadinessConflictError();
        }
        if (
          event.status === "processing" &&
          (event.leaseExpiresAt === null || event.leaseExpiresAt > input.now)
        ) {
          throw new Error("La provisión de webhooks ya está en ejecución");
        }

        await transaction
          .update(whatsappWebhookEvents)
          .set({
            attempts: 0,
            lastError: null,
            leaseExpiresAt: null,
            leaseToken: null,
            nextAttemptAt: input.now,
            processedAt: null,
            rejectedAt: null,
            status: "pending",
          })
          .where(eq(whatsappWebhookEvents.id, input.eventId));
      },
    );
  },

  async saveForProvisioning(input) {
    if (input.state.clinicId !== input.clinicId) {
      throw new Error("El estado de readiness no pertenece a la Clínica");
    }
    if (
      input.state.connection === null ||
      input.state.projectId === null ||
      input.state.projectId !== input.projectId ||
      input.state.provisioningEventId !== input.eventId ||
      input.state.projectId !== input.state.connection.metadata.projectId ||
      input.state.connection.metadata.provisioningEventId !== input.eventId ||
      input.state.connection.phoneNumberId !== input.phoneNumberId
    ) {
      throw new WhatsAppReadinessConflictError();
    }
    const stateConnection = input.state.connection;

    return inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      await assertActiveProvisioningLease(
        transaction,
        input.eventId,
        input.leaseToken,
        input.now,
      );
      await setProvisioningClinicId(transaction, input.clinicId);
      const [clinic] = await transaction
        .select({
          id: clinics.id,
          subscriptionStatus: clinics.subscriptionStatus,
        })
        .from(clinics)
        .where(eq(clinics.id, input.clinicId));
      if (clinic === undefined) throw new Error("La Clínica no existe");
      await setProvisioningClinicContext(
        transaction,
        input.clinicId,
        clinic.subscriptionStatus,
      );
      // The active provisioning lease has already been checked above. These
      // settings let the RLS policy bind a ready transition to that lease and
      // to the provisioning generation for this Clínica.
      await transaction.execute(
        sql`select set_config('app.whatsapp_provisioning_event_id', ${input.eventId}, true)`,
      );
      await transaction.execute(
        sql`select set_config('app.whatsapp_provisioning_lease_token', ${input.leaseToken}, true)`,
      );
      await lockWhatsAppCircuit(transaction, input.clinicId);

      const [persistedConnection] = await transaction
        .select()
        .from(whatsappConnections)
        .where(eq(whatsappConnections.clinicId, input.clinicId))
        .for("update");
      if (
        persistedConnection?.phoneNumberId !== input.phoneNumberId ||
        persistedConnection?.metadata.projectId !== input.projectId ||
        persistedConnection?.metadata.provisioningEventId !== input.eventId
      ) {
        throw new WhatsAppReadinessConflictError();
      }

      await transaction
        .update(whatsappConnections)
        .set({
          lastTestAt: stateConnection.lastTestAt,
          metadata: mergeOperationalMetadata(
            persistedConnection.metadata,
            stateConnection.metadata,
          ),
          status: (await isCircuitOpen(transaction, input.clinicId))
            ? "blocked"
            : stateConnection.status,
          updatedAt: stateConnection.updatedAt,
        })
        .where(eq(whatsappConnections.clinicId, input.clinicId));

      await persistReadinessState(transaction, input.state);
      return readRecord(transaction, input.clinicId, false);
    });
  },

  async openAlert(input) {
    await inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      await setProvisioningClinicId(transaction, input.clinicId);
      if (input.access === "provisioning-worker") {
        await assertActiveProvisioningLease(
          transaction,
          input.eventId,
          input.leaseToken,
          input.now,
        );
      } else {
        await assertActiveReconciliationLease(
          transaction,
          input.clinicId,
          input.leaseToken,
          input.now,
        );
      }
      if (input.access === "reconciliation-worker") {
        await setReconciliationContext(transaction, input.leaseToken);
      }
      await insertOrUpdateAlert(transaction, {
        clinicId: input.clinicId,
        gateCode: input.gateCode,
        nextAction: input.nextAction,
        now: input.now,
        provisioningEventId: input.eventId,
        reason: input.reason,
      });
    });
  },

  async syncAlerts(input) {
    const operation = async (transaction: ClinicTransaction) => {
      await setProvisioningClinicId(transaction, input.clinicId);
      if (input.access === "reconciliation-worker") {
        await assertActiveReconciliationLease(
          transaction,
          input.clinicId,
          input.leaseToken,
          input.now,
        );
        await setReconciliationContext(transaction, input.leaseToken);
      }
      return syncAlertsInTransaction(transaction, input);
    };
    if (
      input.access === "provisioning-worker" ||
      input.access === "reconciliation-worker"
    ) {
      await inWhatsAppProvisioningWorkerTransaction(operation);
      return;
    }
    return inSuperadminTransaction(input.actorIdentityId, operation);
  },

  async save(input) {
    if (input.state.clinicId !== input.clinicId) {
      throw new Error("El estado de readiness no pertenece a la Clínica");
    }
    const operation = async (transaction: ClinicTransaction) => {
      await lockWhatsAppCircuit(transaction, input.clinicId);
      const persistedReadiness =
        await transaction.query.whatsappReadiness.findFirst({
          where: eq(whatsappReadiness.clinicId, input.clinicId),
        });
      if ((persistedReadiness?.revision ?? 0) !== input.expectedRevision) {
        throw new WhatsAppReadinessConflictError();
      }

      const clinic = await transaction.query.clinics.findFirst({
        columns: { id: true, subscriptionStatus: true },
        where: eq(clinics.id, input.clinicId),
      });
      if (clinic === undefined) throw new Error("La Clínica no existe");

      await transaction.execute(
        // El contexto también protege las tablas cuando el caller es un
        // superadmin y evita que una fila preparada cruce de Clínica.
        sql`select set_config('app.clinic_id', ${input.clinicId}, true)`,
      );
      await transaction.execute(
        sql`select set_config('app.subscription_status', ${clinic.subscriptionStatus}, true)`,
      );

      const connection = input.state.connection;
      if (connection === null) {
        throw new Error("No se puede guardar readiness sin Conexión");
      }
      const [persistedConnection] = await transaction
        .select()
        .from(whatsappConnections)
        .where(eq(whatsappConnections.clinicId, input.clinicId))
        .for("update");
      const expectedConnectionUpdatedAt = input.expectedConnectionUpdatedAt;
      if (
        persistedConnection === undefined ||
        expectedConnectionUpdatedAt === null
      ) {
        throw new WhatsAppReadinessConflictError();
      }
      if (
        persistedConnection.updatedAt.getTime() !==
          expectedConnectionUpdatedAt.getTime() ||
        persistedConnection.provider !== connection.provider ||
        persistedConnection.connectionType !== connection.connectionType ||
        persistedConnection.customer !== connection.customer ||
        persistedConnection.phoneNumberE164 !== connection.phoneNumberE164 ||
        persistedConnection.phoneNumberId !== connection.phoneNumberId ||
        persistedConnection.businessAccountId !==
          (connection.businessAccountId ?? null)
      ) {
        throw new WhatsAppReadinessConflictError();
      }
      if (
        !isSameWhatsAppReadinessGeneration(
          input.expectedGeneration,
          getWhatsAppReadinessGeneration(persistedConnection),
        ) ||
        !isSameWhatsAppReadinessGeneration(
          input.expectedGeneration,
          getWhatsAppReadinessGeneration(connection),
        ) ||
        input.state.projectId !== input.expectedGeneration.projectId ||
        input.state.provisioningEventId !==
          input.expectedGeneration.provisioningEventId
      ) {
        throw new WhatsAppReadinessConflictError();
      }
      const metadata = publicWhatsAppConnectionMetadata(
        persistedConnection.metadata,
      );
      for (const key of [
        "billingStatus",
        "health",
        "nextAction",
        "statusReason",
        "templatesStatus",
        "webhookStatus",
      ] as const) {
        const value = connection.metadata[key];
        if (value !== undefined) metadata[key] = value;
      }
      await transaction
        .update(whatsappConnections)
        .set({
          lastTestAt: connection.lastTestAt,
          metadata,
          status: (await isCircuitOpen(transaction, input.clinicId))
            ? "blocked"
            : connection.status,
          updatedAt: connection.updatedAt,
        })
        .where(eq(whatsappConnections.clinicId, input.clinicId));

      await persistReadinessState(transaction, input.state);
      return readRecord(transaction, input.clinicId, false);
    };

    if (input.access !== "superadmin") {
      throw new Error("Solo un superadmin puede actualizar readiness");
    }
    return inSuperadminTransaction(input.actorIdentityId, operation);
  },
};

async function readRecord(
  transaction: ClinicTransaction,
  clinicId: string,
  includeAlerts: boolean,
): Promise<WhatsAppReadinessRecord> {
  const connection = await transaction.query.whatsappConnections.findFirst({
    where: eq(whatsappConnections.clinicId, clinicId),
  });
  const phoneNumberId = connection?.phoneNumberId;
  const projectId = connection?.metadata.projectId ?? null;
  const provisioningEventId = connection?.metadata.provisioningEventId ?? null;
  const hasCurrentGeneration =
    phoneNumberId !== null && phoneNumberId !== undefined;
  const [readiness, billing, templates, projectWebhook, phoneWebhook, alerts] =
    await Promise.all([
      transaction.query.whatsappReadiness.findFirst({
        where: eq(whatsappReadiness.clinicId, clinicId),
      }),
      transaction.query.whatsappBilling.findFirst({
        where: eq(whatsappBilling.clinicId, clinicId),
      }),
      hasCurrentGeneration
        ? transaction.query.whatsappCriticalTemplates.findMany({
            where: and(
              eq(whatsappCriticalTemplates.clinicId, clinicId),
              projectId === null
                ? isNull(whatsappCriticalTemplates.projectId)
                : eq(whatsappCriticalTemplates.projectId, projectId),
              provisioningEventId === null
                ? isNull(whatsappCriticalTemplates.provisioningEventId)
                : eq(
                    whatsappCriticalTemplates.provisioningEventId,
                    provisioningEventId,
                  ),
            ),
            orderBy: (items, { asc }) => [asc(items.kind)],
          })
        : Promise.resolve([]),
      phoneNumberId === null ||
      phoneNumberId === undefined ||
      projectId === null ||
      provisioningEventId === null
        ? Promise.resolve(undefined)
        : transaction.query.whatsappProvisioningSteps.findFirst({
            where: and(
              eq(whatsappProvisioningSteps.clinicId, clinicId),
              eq(whatsappProvisioningSteps.eventId, provisioningEventId),
              eq(whatsappProvisioningSteps.phoneNumberId, phoneNumberId),
              eq(whatsappProvisioningSteps.projectId, projectId),
              eq(whatsappProvisioningSteps.step, "project-webhook"),
            ),
            orderBy: (steps, { desc }) => [desc(steps.updatedAt)],
          }),
      phoneNumberId === null ||
      phoneNumberId === undefined ||
      projectId === null ||
      provisioningEventId === null
        ? Promise.resolve(undefined)
        : transaction.query.whatsappProvisioningSteps.findFirst({
            where: and(
              eq(whatsappProvisioningSteps.clinicId, clinicId),
              eq(whatsappProvisioningSteps.eventId, provisioningEventId),
              eq(whatsappProvisioningSteps.phoneNumberId, phoneNumberId),
              eq(whatsappProvisioningSteps.projectId, projectId),
              eq(whatsappProvisioningSteps.step, "phone-number-webhook"),
            ),
            orderBy: (steps, { desc }) => [desc(steps.updatedAt)],
          }),
      includeAlerts &&
      hasCurrentGeneration &&
      provisioningEventId !== null &&
      connection?.status !== "disconnected"
        ? transaction
            .select()
            .from(whatsappConnectionAlerts)
            .where(
              and(
                eq(whatsappConnectionAlerts.clinicId, clinicId),
                eq(
                  whatsappConnectionAlerts.provisioningEventId,
                  provisioningEventId,
                ),
              ),
            )
            .orderBy(whatsappConnectionAlerts.updatedAt)
        : Promise.resolve([]),
    ]);
  const evidenceMatchesConnection =
    connection !== undefined &&
    readiness?.provisioningEventId === provisioningEventId &&
    readiness?.projectId === projectId &&
    readiness?.phoneNumberId === (connection.phoneNumberId ?? null) &&
    readiness?.businessAccountId === (connection.businessAccountId ?? null);

  return toRecord({
    alerts: includeAlerts ? alerts.map(toAlert) : [],
    billing: evidenceMatchesConnection ? billing : undefined,
    connection,
    phoneWebhook,
    projectWebhook,
    readiness: evidenceMatchesConnection ? readiness : undefined,
    readinessRevision: readiness?.revision ?? 0,
    templates: evidenceMatchesConnection ? templates : [],
    clinicId,
  });
}

async function assertActiveProvisioningLease(
  transaction: ClinicTransaction,
  eventId: string,
  leaseToken: string,
  now: Date,
) {
  const [event] = await transaction
    .select({ id: whatsappWebhookEvents.id })
    .from(whatsappWebhookEvents)
    .where(
      and(
        eq(whatsappWebhookEvents.id, eventId),
        eq(whatsappWebhookEvents.leaseToken, leaseToken),
        eq(whatsappWebhookEvents.status, "processing"),
        gt(whatsappWebhookEvents.leaseExpiresAt, now),
      ),
    );
  if (event === undefined) {
    throw new WhatsAppReadinessConflictError();
  }
}

async function assertActiveReconciliationLease(
  transaction: ClinicTransaction,
  clinicId: string,
  leaseToken: string,
  now: Date,
) {
  const [lease] = await transaction
    .select({ clinicId: whatsappReadiness.clinicId })
    .from(whatsappReadiness)
    .where(
      and(
        eq(whatsappReadiness.clinicId, clinicId),
        eq(whatsappReadiness.reconciliationLeaseToken, leaseToken),
        eq(whatsappReadiness.reconciliationStatus, "processing"),
        gt(whatsappReadiness.reconciliationLeaseExpiresAt, now),
      ),
    );
  if (lease === undefined) throw new WhatsAppReadinessConflictError();
}

async function setReconciliationContext(
  transaction: ClinicTransaction,
  leaseToken: string,
) {
  await transaction.execute(
    sql`select set_config('app.whatsapp_readiness_reconciliation_worker', 'true', true)`,
  );
  await transaction.execute(
    sql`select set_config('app.whatsapp_reconciliation_lease_token', ${leaseToken}, true)`,
  );
}

async function setProvisioningClinicContextForWorker(
  transaction: ClinicTransaction,
  clinicId: string,
) {
  const clinic = await transaction.query.clinics.findFirst({
    columns: { subscriptionStatus: true },
    where: eq(clinics.id, clinicId),
  });
  if (clinic === undefined) throw new Error("La Clínica no existe");
  await setProvisioningClinicContext(
    transaction,
    clinicId,
    clinic.subscriptionStatus,
  );
}

async function setProvisioningClinicContext(
  transaction: ClinicTransaction,
  clinicId: string,
  subscriptionStatus: "active" | "suspended",
) {
  await setProvisioningClinicId(transaction, clinicId);
  await transaction.execute(
    sql`select set_config('app.subscription_status', ${subscriptionStatus}, true)`,
  );
}

async function setProvisioningClinicId(
  transaction: ClinicTransaction,
  clinicId: string,
) {
  await transaction.execute(
    sql`select set_config('app.clinic_id', ${clinicId}, true)`,
  );
}

function mergeOperationalMetadata(
  current: (typeof whatsappConnections.$inferSelect)["metadata"],
  next: (typeof whatsappConnections.$inferSelect)["metadata"],
) {
  return publicWhatsAppConnectionMetadata({ ...current, ...next });
}

async function isCircuitOpen(transaction: ClinicTransaction, clinicId: string) {
  const circuit = await transaction.query.whatsappCircuitBreakers.findFirst({
    columns: { status: true },
    where: eq(whatsappCircuitBreakers.clinicId, clinicId),
  });
  return circuit?.status === "open";
}

async function persistReadinessState(
  transaction: ClinicTransaction,
  state: WhatsAppReadinessRecord,
) {
  await lockWhatsAppCircuit(transaction, state.clinicId);
  const [persistedBilling] = await transaction
    .select()
    .from(whatsappBilling)
    .where(eq(whatsappBilling.clinicId, state.clinicId))
    .for("update");
  const incomingBillingSnapshotIsOlder =
    persistedBilling !== undefined &&
    persistedBilling.lastSyncedAt !== null &&
    (state.billing.lastSyncedAt === null ||
      persistedBilling.lastSyncedAt > state.billing.lastSyncedAt);
  const localConsumedSinceSnapshot =
    persistedBilling !== undefined &&
    state.billing.consumedCents < persistedBilling.consumedCents
      ? persistedBilling.consumedCents - state.billing.consumedCents
      : 0;
  const creditCents =
    incomingBillingSnapshotIsOlder && persistedBilling !== undefined
      ? persistedBilling.creditCents
      : Math.max(0, state.billing.creditCents - localConsumedSinceSnapshot);
  const billingSnapshotValues =
    incomingBillingSnapshotIsOlder && persistedBilling !== undefined
      ? {
          alertThresholdCents: persistedBilling.alertThresholdCents,
          chargesSeparated: persistedBilling.chargesSeparated,
          creditLimitCents: persistedBilling.creditLimitCents,
          creditReserveCents: persistedBilling.creditReserveCents,
          estimatedDailyConsumptionCents:
            persistedBilling.estimatedDailyConsumptionCents,
          warningBalancePercent: persistedBilling.warningBalancePercent,
          criticalBalancePercent: persistedBilling.criticalBalancePercent,
          warningAutonomyDays: persistedBilling.warningAutonomyDays,
          criticalAutonomyDays: persistedBilling.criticalAutonomyDays,
          kapsoMonthlyQuota: persistedBilling.kapsoMonthlyQuota,
          kapsoQuotaPeriod: persistedBilling.kapsoQuotaPeriod,
          kapsoQuotaReserved: persistedBilling.kapsoQuotaReserved,
          lastError: persistedBilling.lastError,
          lastSyncedAt: persistedBilling.lastSyncedAt,
          metaChargesCents: persistedBilling.metaChargesCents,
          mode: persistedBilling.mode,
          platformChargesCents: persistedBilling.platformChargesCents,
          status: persistedBilling.status,
        }
      : {
          alertThresholdCents: state.billing.alertThresholdCents,
          chargesSeparated: state.billing.chargesSeparated,
          creditLimitCents: state.billing.creditLimitCents ?? null,
          creditReserveCents: state.billing.creditReserveCents ?? null,
          estimatedDailyConsumptionCents:
            state.billing.estimatedDailyConsumptionCents ?? 0,
          warningBalancePercent: state.billing.warningBalancePercent ?? 20,
          criticalBalancePercent: state.billing.criticalBalancePercent ?? 10,
          warningAutonomyDays: state.billing.warningAutonomyDays ?? 7,
          criticalAutonomyDays: state.billing.criticalAutonomyDays ?? 3,
          kapsoMonthlyQuota: state.billing.kapsoMonthlyQuota ?? null,
          kapsoQuotaPeriod:
            state.billing.kapsoQuotaPeriod ??
            persistedBilling?.kapsoQuotaPeriod ??
            null,
          kapsoQuotaReserved: state.billing.kapsoQuotaReserved ?? 0,
          lastError: state.billing.lastError,
          lastSyncedAt: state.billing.lastSyncedAt,
          metaChargesCents: state.billing.metaChargesCents ?? null,
          mode: state.billing.mode,
          platformChargesCents: state.billing.platformChargesCents ?? null,
          status: state.billing.status,
        };
  const billingUpdatedAt =
    incomingBillingSnapshotIsOlder && persistedBilling !== undefined
      ? persistedBilling.updatedAt
      : new Date();
  const kapsoQuotaConsumed = reconcileWhatsAppQuotaConsumption({
    incomingConsumed: state.billing.kapsoQuotaConsumed ?? 0,
    incomingPeriod: state.billing.kapsoQuotaPeriod,
    incomingSnapshotIsOlder: incomingBillingSnapshotIsOlder,
    persistedConsumed: persistedBilling?.kapsoQuotaConsumed ?? 0,
    persistedPeriod: persistedBilling?.kapsoQuotaPeriod,
  });
  await transaction
    .insert(whatsappReadiness)
    .values(toReadinessRow(state))
    .onConflictDoUpdate({
      target: whatsappReadiness.clinicId,
      set: toReadinessUpdate(state),
    });

  if (
    state.templatesSync.status === "ready" &&
    state.projectId !== null &&
    state.provisioningEventId !== null
  ) {
    await transaction
      .delete(whatsappCriticalTemplates)
      .where(
        and(
          eq(whatsappCriticalTemplates.clinicId, state.clinicId),
          eq(whatsappCriticalTemplates.projectId, state.projectId),
          eq(
            whatsappCriticalTemplates.provisioningEventId,
            state.provisioningEventId,
          ),
        ),
      );
  }

  for (const template of state.templates) {
    const persistedTemplate = toTemplatePersistenceValues(template);
    await transaction
      .insert(whatsappCriticalTemplates)
      .values({
        category: template.category,
        ...persistedTemplate,
        clinicId: state.clinicId,
        kind: template.kind,
        locale: template.locale,
        name: template.name,
        projectId: state.projectId,
        provisioningEventId: state.provisioningEventId,
        providerTemplateId: template.providerTemplateId,
        rejectionReason: template.rejectionReason,
        status: template.status,
        syncedAt: template.syncedAt,
        variables: template.variables,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          whatsappCriticalTemplates.clinicId,
          whatsappCriticalTemplates.kind,
        ],
        set: {
          category: template.category,
          ...persistedTemplate,
          locale: template.locale,
          name: template.name,
          projectId: state.projectId,
          provisioningEventId: state.provisioningEventId,
          providerTemplateId: template.providerTemplateId,
          rejectionReason: template.rejectionReason,
          status: template.status,
          syncedAt: template.syncedAt,
          variables: template.variables,
          updatedAt: new Date(),
        },
      });
  }

  await transaction
    .insert(whatsappBilling)
    .values({
      ...billingSnapshotValues,
      clinicId: state.clinicId,
      consumedCents: state.billing.consumedCents,
      creditCents,
      kapsoQuotaConsumed,
      updatedAt: billingUpdatedAt,
    })
    .onConflictDoUpdate({
      target: whatsappBilling.clinicId,
      set: {
        ...billingSnapshotValues,
        consumedCents: sql`greatest(${whatsappBilling.consumedCents}, ${state.billing.consumedCents})`,
        creditCents,
        kapsoQuotaConsumed,
        metaChargesCents:
          incomingBillingSnapshotIsOlder && persistedBilling !== undefined
            ? persistedBilling.metaChargesCents
            : state.billing.metaChargesCents === null ||
                state.billing.metaChargesCents === undefined
              ? whatsappBilling.metaChargesCents
              : sql`greatest(coalesce(${whatsappBilling.metaChargesCents}, 0), ${state.billing.metaChargesCents})`,
        updatedAt: billingUpdatedAt,
      },
    });
}

async function insertOrUpdateAlert(
  transaction: ClinicTransaction,
  input: {
    clinicId: string;
    gateCode: WhatsAppConnectionAlert["gateCode"];
    nextAction: string;
    now: Date;
    provisioningEventId: string;
    reason: string;
  },
) {
  await transaction
    .insert(whatsappConnectionAlerts)
    .values({
      clinicId: input.clinicId,
      gateCode: input.gateCode,
      nextAction: input.nextAction,
      provisioningEventId: input.provisioningEventId,
      reason: input.reason.slice(0, 1_000),
      status: "open",
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [
        whatsappConnectionAlerts.clinicId,
        whatsappConnectionAlerts.provisioningEventId,
        whatsappConnectionAlerts.gateCode,
      ],
      set: {
        nextAction: input.nextAction,
        reason: input.reason.slice(0, 1_000),
        resolvedAt: null,
        status: "open",
        updatedAt: input.now,
      },
    });
}

async function syncAlertsInTransaction(
  transaction: ClinicTransaction,
  input: WhatsAppReadinessAlertSyncInput,
) {
  if (input.access === "provisioning-worker") {
    await assertActiveProvisioningLease(
      transaction,
      input.provisioningEventId,
      input.leaseToken,
      input.now,
    );
  }

  const failedGates = input.gates.filter((gate) =>
    isWhatsAppOperationalFailure(gate.status),
  );
  const failedCodes = new Set(failedGates.map((gate) => gate.code));
  for (const gate of failedGates) {
    await insertOrUpdateAlert(transaction, {
      clinicId: input.clinicId,
      gateCode: gate.code,
      nextAction: gate.action || "Revisar la Conexión de WhatsApp",
      now: input.now,
      provisioningEventId: input.provisioningEventId,
      reason: gate.message,
    });
  }

  const openAlerts = await transaction
    .select({ gateCode: whatsappConnectionAlerts.gateCode })
    .from(whatsappConnectionAlerts)
    .where(
      and(
        eq(whatsappConnectionAlerts.clinicId, input.clinicId),
        eq(
          whatsappConnectionAlerts.provisioningEventId,
          input.provisioningEventId,
        ),
        eq(whatsappConnectionAlerts.status, "open"),
      ),
    );
  for (const alert of openAlerts) {
    if (failedCodes.has(alert.gateCode)) continue;
    await transaction
      .update(whatsappConnectionAlerts)
      .set({
        resolvedAt: input.now,
        status: "resolved",
        updatedAt: input.now,
      })
      .where(
        and(
          eq(whatsappConnectionAlerts.clinicId, input.clinicId),
          eq(
            whatsappConnectionAlerts.provisioningEventId,
            input.provisioningEventId,
          ),
          eq(whatsappConnectionAlerts.gateCode, alert.gateCode),
          eq(whatsappConnectionAlerts.status, "open"),
        ),
      );
  }
}

function toAlert(
  alert: typeof whatsappConnectionAlerts.$inferSelect,
): WhatsAppConnectionAlert {
  return {
    clinicId: alert.clinicId,
    createdAt: alert.createdAt,
    gateCode: alert.gateCode,
    id: alert.id,
    nextAction: alert.nextAction,
    provisioningEventId: alert.provisioningEventId,
    reason: alert.reason,
    resolvedAt: alert.resolvedAt,
    status: alert.status,
    updatedAt: alert.updatedAt,
  };
}

function toRecord(input: {
  alerts?: WhatsAppConnectionAlert[];
  billing: typeof whatsappBilling.$inferSelect | undefined;
  clinicId: string;
  connection: typeof whatsappConnections.$inferSelect | undefined;
  phoneWebhook: typeof whatsappProvisioningSteps.$inferSelect | undefined;
  projectWebhook: typeof whatsappProvisioningSteps.$inferSelect | undefined;
  readiness: typeof whatsappReadiness.$inferSelect | undefined;
  readinessRevision?: number;
  templates: (typeof whatsappCriticalTemplates.$inferSelect)[];
}): WhatsAppReadinessRecord {
  const connection =
    input.connection === undefined
      ? null
      : {
          ...input.connection,
          metadata: publicWhatsAppConnectionMetadata(input.connection.metadata),
        };
  const metadata = connection?.metadata ?? {};
  const metadataWebhookStatus =
    metadata.webhookStatus === "ready"
      ? ("ready" as const)
      : metadata.webhookStatus === "failed"
        ? ("failed" as const)
        : ("pending" as const);
  return {
    alerts: input.alerts ?? [],
    billing: {
      alertThresholdCents: input.billing?.alertThresholdCents ?? null,
      chargesSeparated: input.billing?.chargesSeparated ?? false,
      consumedCents: input.billing?.consumedCents ?? 0,
      creditCents: input.billing?.creditCents ?? 0,
      creditInFlightCents: input.billing?.creditInFlightCents ?? 0,
      creditLimitCents: input.billing?.creditLimitCents ?? null,
      creditReserveCents: input.billing?.creditReserveCents ?? null,
      estimatedDailyConsumptionCents:
        input.billing?.estimatedDailyConsumptionCents ?? 0,
      warningBalancePercent: input.billing?.warningBalancePercent ?? 20,
      criticalBalancePercent: input.billing?.criticalBalancePercent ?? 10,
      warningAutonomyDays: input.billing?.warningAutonomyDays ?? 7,
      criticalAutonomyDays: input.billing?.criticalAutonomyDays ?? 3,
      kapsoMonthlyQuota: input.billing?.kapsoMonthlyQuota ?? null,
      kapsoQuotaPeriod: input.billing?.kapsoQuotaPeriod ?? null,
      kapsoQuotaConsumed: input.billing?.kapsoQuotaConsumed ?? 0,
      kapsoQuotaReserved: input.billing?.kapsoQuotaReserved ?? 0,
      kapsoQuotaInFlight: input.billing?.kapsoQuotaInFlight ?? 0,
      lastError: input.billing?.lastError ?? null,
      lastSyncedAt: input.billing?.lastSyncedAt ?? null,
      metaChargesCents: input.billing?.metaChargesCents ?? null,
      mode: input.billing?.mode ?? "unknown",
      platformChargesCents: input.billing?.platformChargesCents ?? null,
      status: input.billing?.status ?? "pending",
    },
    clinicId: input.clinicId,
    connection,
    e2e: {
      evidence: input.readiness?.e2eEvidence ?? null,
      evidenceScope: input.readiness?.e2eEvidenceScope ?? null,
      lastError: input.readiness?.e2eLastError ?? null,
      lastTestAt: input.readiness?.e2eLastTestAt ?? null,
      status: input.readiness?.e2eStatus ?? "pending",
    },
    nextAction:
      input.readiness?.nextAction ??
      metadata.nextAction ??
      "Esperar la provisión de WhatsApp",
    numberEnvironment: input.readiness?.numberEnvironment ?? "unknown",
    numberHealth: input.readiness?.numberHealth ?? "unknown",
    numberHealthCheckedAt: input.readiness?.numberHealthCheckedAt ?? null,
    phoneNumberWebhook: {
      lastAttemptAt:
        input.phoneWebhook?.updatedAt ??
        input.readiness?.phoneNumberWebhookLastAttemptAt ??
        null,
      lastError:
        input.phoneWebhook === undefined
          ? (input.readiness?.phoneNumberWebhookLastError ?? null)
          : input.phoneWebhook.lastError,
      remoteId:
        input.phoneWebhook?.remoteId ??
        (input.phoneWebhook === undefined
          ? (input.readiness?.phoneNumberWebhookId ?? null)
          : null),
      status:
        input.phoneWebhook === undefined
          ? (input.readiness?.phoneNumberWebhookStatus ?? metadataWebhookStatus)
          : provisioningStepStatus(input.phoneWebhook.status),
    },
    projectWebhook: {
      lastAttemptAt:
        input.projectWebhook?.updatedAt ??
        input.readiness?.projectWebhookLastAttemptAt ??
        null,
      lastError:
        input.projectWebhook === undefined
          ? (input.readiness?.projectWebhookLastError ?? null)
          : input.projectWebhook.lastError,
      remoteId:
        input.projectWebhook?.remoteId ??
        (input.projectWebhook === undefined
          ? (input.readiness?.projectWebhookId ?? null)
          : null),
      status:
        input.projectWebhook === undefined
          ? (input.readiness?.projectWebhookStatus ?? metadataWebhookStatus)
          : provisioningStepStatus(input.projectWebhook.status),
    },
    reconciliation: {
      attempts: input.readiness?.reconciliationAttempts ?? 0,
      lastAttemptAt: input.readiness?.reconciliationLastAttemptAt ?? null,
      lastError: input.readiness?.reconciliationLastError ?? null,
      nextAttemptAt: input.readiness?.reconciliationNextAttemptAt ?? null,
      status: input.readiness?.reconciliationStatus ?? "pending",
    },
    statusReason:
      input.readiness?.statusReason ??
      metadata.statusReason ??
      "Pendiente de evaluar los gates técnicos",
    templates: input.templates.map((template) => ({
      category: template.category,
      catalogVersion: template.catalogVersion,
      content: template.content,
      kind: template.kind,
      locale: template.locale,
      name: template.name,
      providerTemplateId: template.providerTemplateId,
      examples: template.examples,
      provisioningStatus: template.provisioningStatus,
      rejectionReason: template.rejectionReason,
      status: template.status,
      syncedAt: template.syncedAt,
      variables: template.variables,
    })),
    templatesSync: {
      lastError: input.readiness?.templatesSyncLastError ?? null,
      lastSyncedAt: input.readiness?.templatesSyncLastSyncedAt ?? null,
      status: input.readiness?.templatesSyncStatus ?? "pending",
    },
    technicalStatus: input.readiness?.technicalStatus ?? "pending",
    projectId: input.readiness?.projectId ?? metadata.projectId ?? null,
    provisioningEventId:
      input.readiness?.provisioningEventId ??
      metadata.provisioningEventId ??
      null,
    revision: input.readiness?.revision ?? input.readinessRevision ?? 0,
  };
}

function toTemplatePersistenceValues(template: WhatsAppTemplateSnapshot) {
  const definition = whatsappCriticalTemplateCatalog.find(
    (candidate) => candidate.kind === template.kind,
  );
  return {
    catalogVersion: template.catalogVersion ?? definition?.version ?? 1,
    content: template.content ?? definition?.content ?? "",
    examples:
      template.examples ??
      (definition === undefined ? {} : { ...definition.examples }),
    provisioningStatus:
      template.provisioningStatus ?? legacyProvisioningStatus(template.status),
  };
}

function legacyProvisioningStatus(
  status: WhatsAppTemplateSnapshot["status"],
): WhatsAppTemplateProvisioningStatus {
  switch (status) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
    case "DISABLED":
      return "rejected";
    case "PENDING":
    default:
      return "in_review";
  }
}

function toReadinessRow(state: WhatsAppReadinessRecord) {
  return {
    billingSyncLastError: state.billing.lastError,
    billingSyncLastSyncedAt: state.billing.lastSyncedAt,
    billingSyncStatus: state.billing.status,
    clinicId: state.clinicId,
    businessAccountId: state.connection?.businessAccountId ?? null,
    e2eEvidenceScope: state.e2e.evidenceScope,
    e2eEvidence: state.e2e.evidence,
    e2eLastError: state.e2e.lastError,
    e2eLastTestAt: state.e2e.lastTestAt,
    e2eStatus: state.e2e.status,
    nextAction: state.nextAction,
    numberEnvironment: state.numberEnvironment,
    numberHealth: state.numberHealth,
    numberHealthCheckedAt: state.numberHealthCheckedAt,
    phoneNumberId: state.connection?.phoneNumberId ?? null,
    phoneNumberWebhookId: state.phoneNumberWebhook.remoteId,
    phoneNumberWebhookLastAttemptAt: state.phoneNumberWebhook.lastAttemptAt,
    phoneNumberWebhookLastError: state.phoneNumberWebhook.lastError,
    phoneNumberWebhookStatus: state.phoneNumberWebhook.status,
    projectWebhookId: state.projectWebhook.remoteId,
    projectWebhookLastAttemptAt: state.projectWebhook.lastAttemptAt,
    projectWebhookLastError: state.projectWebhook.lastError,
    projectWebhookStatus: state.projectWebhook.status,
    projectId: state.projectId,
    provisioningEventId: state.provisioningEventId,
    reconciliationAttempts: state.reconciliation.attempts,
    reconciliationLastAttemptAt: state.reconciliation.lastAttemptAt,
    reconciliationLastError: state.reconciliation.lastError,
    reconciliationNextAttemptAt: state.reconciliation.nextAttemptAt,
    reconciliationStatus: state.reconciliation.status,
    revision: (state.revision ?? 0) + 1,
    statusReason: state.statusReason,
    technicalStatus: state.technicalStatus,
    templatesSyncLastError: state.templatesSync.lastError,
    templatesSyncLastSyncedAt: state.templatesSync.lastSyncedAt,
    templatesSyncStatus: state.templatesSync.status,
    updatedAt: new Date(),
  };
}

function provisioningStepStatus(status: "succeeded" | "failed") {
  return status === "succeeded" ? ("ready" as const) : ("failed" as const);
}

function toReadinessUpdate(state: WhatsAppReadinessRecord) {
  const row = toReadinessRow(state);
  const { clinicId: _clinicId, ...update } = row;
  void _clinicId;
  return update;
}
