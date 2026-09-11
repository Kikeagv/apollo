import { and, eq, sql } from "drizzle-orm";

import {
  WhatsAppReadinessConflictError,
  type WhatsAppReadinessAlertSyncInput,
  type WhatsAppReadinessRecord,
  type WhatsAppReadinessProvisioningStore,
  type WhatsAppReadinessStore,
} from "~/server/application/whatsapp-readiness";
import { publicWhatsAppConnectionMetadata } from "~/domain/whatsapp-connection";
import {
  isWhatsAppOperationalFailure,
  type WhatsAppConnectionAlert,
} from "~/domain/whatsapp-connection-alert";
import {
  inClinicTransaction,
  inWhatsAppProvisioningWorkerTransaction,
  inSuperadminTransaction,
  type ClinicTransaction,
} from "~/server/db/clinic-context";
import {
  clinics,
  clinicUsers,
  whatsappBilling,
  whatsappConnections,
  whatsappConnectionAlerts,
  whatsappCriticalTemplates,
  whatsappProvisioningSteps,
  whatsappReadiness,
  whatsappWebhookEvents,
} from "~/server/db/schema";

export const drizzleWhatsAppReadinessStore: WhatsAppReadinessStore &
  WhatsAppReadinessProvisioningStore = {
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

  async readForProvisioning(input) {
    return inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      await assertActiveProvisioningLease(
        transaction,
        input.eventId,
        input.leaseToken,
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

  async retryWebhooks(input) {
    await inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        const connection =
          await transaction.query.whatsappConnections.findFirst({
            columns: { metadata: true },
            where: eq(whatsappConnections.clinicId, input.clinicId),
          });
        if (connection?.metadata.provisioningEventId !== input.eventId) {
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

    await inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      await assertActiveProvisioningLease(
        transaction,
        input.eventId,
        input.leaseToken,
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
          status: stateConnection.status,
          updatedAt: stateConnection.updatedAt,
        })
        .where(eq(whatsappConnections.clinicId, input.clinicId));

      await persistReadinessState(transaction, input.state);
    });
  },

  async openAlert(input) {
    await inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
      await assertActiveProvisioningLease(
        transaction,
        input.eventId,
        input.leaseToken,
      );
      await setProvisioningClinicId(transaction, input.clinicId);
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
      if (input.access === "provisioning-worker") {
        await setProvisioningClinicId(transaction, input.clinicId);
      }
      return syncAlertsInTransaction(transaction, input);
    };
    if (input.access === "provisioning-worker") {
      await inWhatsAppProvisioningWorkerTransaction(operation);
      return;
    }
    await inSuperadminTransaction(input.actorIdentityId, operation);
  },

  async save(input) {
    if (input.state.clinicId !== input.clinicId) {
      throw new Error("El estado de readiness no pertenece a la Clínica");
    }
    const operation = async (transaction: ClinicTransaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${input.clinicId}))`,
      );
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
          status: connection.status,
          updatedAt: connection.updatedAt,
        })
        .where(eq(whatsappConnections.clinicId, input.clinicId));

      await persistReadinessState(transaction, input.state);
    };

    if (input.access !== "superadmin") {
      throw new Error("Solo un superadmin puede actualizar readiness");
    }
    await inSuperadminTransaction(input.actorIdentityId, operation);
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
    phoneNumberId !== null &&
    phoneNumberId !== undefined &&
    projectId !== null &&
    provisioningEventId !== null;
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
              eq(whatsappCriticalTemplates.projectId, projectId),
              eq(
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
    projectId !== null &&
    provisioningEventId !== null &&
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
) {
  const [event] = await transaction
    .select({ id: whatsappWebhookEvents.id })
    .from(whatsappWebhookEvents)
    .where(
      and(
        eq(whatsappWebhookEvents.id, eventId),
        eq(whatsappWebhookEvents.leaseToken, leaseToken),
        eq(whatsappWebhookEvents.status, "processing"),
      ),
    );
  if (event === undefined) {
    throw new WhatsAppReadinessConflictError();
  }
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

async function persistReadinessState(
  transaction: ClinicTransaction,
  state: WhatsAppReadinessRecord,
) {
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
    await transaction
      .insert(whatsappCriticalTemplates)
      .values({
        category: template.category,
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
      alertThresholdCents: state.billing.alertThresholdCents,
      chargesSeparated: state.billing.chargesSeparated,
      clinicId: state.clinicId,
      consumedCents: state.billing.consumedCents,
      creditCents: state.billing.creditCents,
      metaChargesCents: state.billing.metaChargesCents ?? null,
      lastError: state.billing.lastError,
      lastSyncedAt: state.billing.lastSyncedAt,
      mode: state.billing.mode,
      platformChargesCents: state.billing.platformChargesCents ?? null,
      status: state.billing.status,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: whatsappBilling.clinicId,
      set: {
        alertThresholdCents: state.billing.alertThresholdCents,
        chargesSeparated: state.billing.chargesSeparated,
        consumedCents: state.billing.consumedCents,
        creditCents: state.billing.creditCents,
        metaChargesCents: state.billing.metaChargesCents ?? null,
        lastError: state.billing.lastError,
        lastSyncedAt: state.billing.lastSyncedAt,
        mode: state.billing.mode,
        platformChargesCents: state.billing.platformChargesCents ?? null,
        status: state.billing.status,
        updatedAt: new Date(),
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
    statusReason:
      input.readiness?.statusReason ??
      metadata.statusReason ??
      "Pendiente de evaluar los gates técnicos",
    templates: input.templates.map((template) => ({
      category: template.category,
      kind: template.kind,
      locale: template.locale,
      name: template.name,
      providerTemplateId: template.providerTemplateId,
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
