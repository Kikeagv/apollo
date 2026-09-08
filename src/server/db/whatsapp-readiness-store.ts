import { and, eq, sql } from "drizzle-orm";

import {
  WhatsAppReadinessConflictError,
  type WhatsAppReadinessRecord,
  type WhatsAppReadinessStore,
} from "~/server/application/whatsapp-readiness";
import { publicWhatsAppConnectionMetadata } from "~/domain/whatsapp-connection";
import {
  inClinicTransaction,
  inSuperadminTransaction,
  type ClinicTransaction,
} from "~/server/db/clinic-context";
import {
  clinics,
  clinicUsers,
  whatsappBilling,
  whatsappConnections,
  whatsappCriticalTemplates,
  whatsappProvisioningSteps,
  whatsappReadiness,
} from "~/server/db/schema";

export const drizzleWhatsAppReadinessStore: WhatsAppReadinessStore = {
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

      const connection = await transaction.query.whatsappConnections.findFirst({
        where: eq(whatsappConnections.clinicId, input.clinicId),
      });
      const phoneNumberId = connection?.phoneNumberId;
      const projectId = connection?.metadata.projectId ?? null;
      const provisioningEventId =
        connection?.metadata.provisioningEventId ?? null;
      const hasCurrentGeneration =
        phoneNumberId !== null &&
        phoneNumberId !== undefined &&
        projectId !== null &&
        provisioningEventId !== null;
      const [readiness, billing, templates, projectWebhook, phoneWebhook] =
        await Promise.all([
          transaction.query.whatsappReadiness.findFirst({
            where: eq(whatsappReadiness.clinicId, input.clinicId),
          }),
          transaction.query.whatsappBilling.findFirst({
            where: eq(whatsappBilling.clinicId, input.clinicId),
          }),
          hasCurrentGeneration
            ? transaction.query.whatsappCriticalTemplates.findMany({
                where: and(
                  eq(whatsappCriticalTemplates.clinicId, input.clinicId),
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
                  eq(whatsappProvisioningSteps.clinicId, input.clinicId),
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
                  eq(whatsappProvisioningSteps.clinicId, input.clinicId),
                  eq(whatsappProvisioningSteps.eventId, provisioningEventId),
                  eq(whatsappProvisioningSteps.phoneNumberId, phoneNumberId),
                  eq(whatsappProvisioningSteps.projectId, projectId),
                  eq(whatsappProvisioningSteps.step, "phone-number-webhook"),
                ),
                orderBy: (steps, { desc }) => [desc(steps.updatedAt)],
              }),
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
        billing: evidenceMatchesConnection ? billing : undefined,
        connection,
        phoneWebhook,
        projectWebhook,
        readiness: evidenceMatchesConnection ? readiness : undefined,
        readinessRevision: readiness?.revision ?? 0,
        templates: evidenceMatchesConnection ? templates : [],
        clinicId: input.clinicId,
      });
    };

    if (input.access === "clinic-owner") {
      return inClinicTransaction(
        { clinicId: input.clinicId, identityId: input.actorIdentityId },
        operation,
      );
    }
    return inSuperadminTransaction(input.actorIdentityId, operation);
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

      const state = input.state;
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
              eq(whatsappCriticalTemplates.clinicId, input.clinicId),
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
            clinicId: input.clinicId,
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
          clinicId: input.clinicId,
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
    };

    if (input.access !== "superadmin") {
      throw new Error("Solo un superadmin puede actualizar readiness");
    }
    await inSuperadminTransaction(input.actorIdentityId, operation);
  },
};

function toRecord(input: {
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
