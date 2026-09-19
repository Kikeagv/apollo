import { and, desc, eq, sql } from "drizzle-orm";

import { sanitizeWhatsAppOperationalText } from "~/domain/whatsapp-circuit-breaker";
import { sanitizeWhatsAppSyntheticSmokeResult } from "~/domain/whatsapp-smoke";
import { evaluateWhatsAppReadiness } from "~/domain/whatsapp-readiness";
import {
  inSuperadminTransaction,
  lockWhatsAppCircuit,
  inClinicTransaction,
  type ClinicTransaction,
} from "~/server/db/clinic-context";
import { openWhatsAppCircuitInTransaction } from "~/server/db/whatsapp-circuit-breaker-store";
import { WhatsAppRealTrafficBlockedError } from "~/server/application/whatsapp-provider";
import type {
  WhatsAppOperationsOffboardingStep,
  WhatsAppOperationsSnapshot,
  WhatsAppOperationsStore,
  WhatsAppOffboardingStart,
} from "~/server/application/whatsapp-operations";
import { evaluateWhatsAppOperationsTraffic } from "~/server/application/whatsapp-operations";
import {
  apoloAuditEvents,
  clinics,
  whatsappBilling,
  whatsappCircuitBreakers,
  whatsappConnections,
  whatsappCriticalTemplates,
  whatsappOffboardingRuns,
  whatsappOffboardingStepAudits,
  whatsappOnboardingAuditEvents,
  whatsappProvisioningSteps,
  whatsappReadiness,
  whatsappSetupLinks,
  whatsappSmokeRuns,
  whatsappTrafficGateEvidences,
} from "~/server/db/schema";
import { publicWhatsAppConnectionMetadata } from "~/domain/whatsapp-connection";

const OFFBOARDING_REASON = "Offboarding explícito de la Conexión de WhatsApp";

export const drizzleWhatsAppOperationsStore: WhatsAppOperationsStore = {
  async read(input) {
    return inSuperadminTransaction(input.actorIdentityId, (transaction) =>
      readSnapshot(transaction, input.clinicId),
    );
  },

  async authorizeOffboarding(input) {
    return inClinicTransaction(
      { clinicId: input.clinicId, identityId: input.actorIdentityId },
      async (transaction) => {
        const [updated] = await transaction
          .update(whatsappConnections)
          .set({
            offboardingAuthorizedAt: input.now,
            offboardingAuthorizedByIdentityId: input.actorIdentityId,
          })
          .where(eq(whatsappConnections.clinicId, input.clinicId))
          .returning({
            offboardingAuthorizedAt:
              whatsappConnections.offboardingAuthorizedAt,
            offboardingAuthorizedByIdentityId:
              whatsappConnections.offboardingAuthorizedByIdentityId,
          });
        if (
          updated?.offboardingAuthorizedAt === null ||
          updated?.offboardingAuthorizedAt === undefined ||
          updated.offboardingAuthorizedByIdentityId === null
        ) {
          throw new Error("La Clínica no tiene una Conexión para autorizar");
        }
        await transaction.insert(whatsappOnboardingAuditEvents).values({
          action: "offboarding-authorized",
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          reason: "Autorización explícita de la Clínica para retirar WhatsApp",
          result: "succeeded",
        });
        return {
          authorizedAt: updated.offboardingAuthorizedAt,
          authorizedByIdentityId: updated.offboardingAuthorizedByIdentityId,
        };
      },
    );
  },

  async recordTrafficGate(input) {
    return inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        await lockWhatsAppCircuit(transaction, input.clinicId);
        await setClinicContext(transaction, input.clinicId);
        await transaction
          .insert(whatsappTrafficGateEvidences)
          .values({
            clinicId: input.clinicId,
            code: input.code,
            evidenceReference: sanitizeEvidence(input.evidenceReference),
            ready: input.ready,
            recordedByIdentityId: input.actorIdentityId,
            recordedAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoUpdate({
            target: [
              whatsappTrafficGateEvidences.clinicId,
              whatsappTrafficGateEvidences.code,
            ],
            set: {
              evidenceReference: sanitizeEvidence(input.evidenceReference),
              ready: input.ready,
              recordedByIdentityId: input.actorIdentityId,
              recordedAt: input.now,
              updatedAt: input.now,
            },
          });
        await insertApoloAudit(transaction, {
          action: "whatsapp-traffic-gate-recorded",
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          occurredAt: input.now,
        });
        const snapshot = await readSnapshot(transaction, input.clinicId);
        await blockUnsafeRealTraffic(transaction, snapshot, {
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          now: input.now,
        });
        return readSnapshot(transaction, input.clinicId);
      },
    );
  },

  async saveSyntheticSmokeRun(input) {
    return inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        const result = sanitizeWhatsAppSyntheticSmokeResult(input.result);
        const evidence = buildSmokeEvidence(result);
        await lockWhatsAppCircuit(transaction, input.clinicId);
        await setClinicContext(transaction, input.clinicId);
        await assertProvisioningGenerationBelongsToClinic(
          transaction,
          input.clinicId,
          input.provisioningEventId,
        );
        await transaction
          .insert(whatsappSmokeRuns)
          .values({
            actorIdentityId: input.actorIdentityId,
            blockers: result.blockers,
            clinicId: input.clinicId,
            createdAt: input.finishedAt,
            evidence,
            finishedAt: input.finishedAt,
            id: input.runId,
            provisioningEventId: input.provisioningEventId,
            providerTransportVerified:
              result.providerTransportVerified === true,
            realPatientsEnabled: result.realPatientsEnabled,
            startedAt: input.startedAt,
            status: result.status,
            steps: result.steps,
            syntheticContact: result.syntheticContact,
          })
          .onConflictDoUpdate({
            target: whatsappSmokeRuns.id,
            set: {
              blockers: result.blockers,
              evidence,
              finishedAt: input.finishedAt,
              provisioningEventId: input.provisioningEventId,
              providerTransportVerified:
                result.providerTransportVerified === true,
              realPatientsEnabled: result.realPatientsEnabled,
              status: result.status,
              steps: result.steps,
              syntheticContact: result.syntheticContact,
            },
          });
        await insertApoloAudit(transaction, {
          action:
            result.status === "passed"
              ? "whatsapp-synthetic-smoke-passed"
              : "whatsapp-synthetic-smoke-failed",
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          occurredAt: input.finishedAt,
        });
        const snapshot = await readSnapshot(transaction, input.clinicId);
        await blockUnsafeRealTraffic(transaction, snapshot, {
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          now: input.finishedAt,
        });
        return readSnapshot(transaction, input.clinicId);
      },
    );
  },

  async enableRealTraffic(input) {
    return inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        await lockWhatsAppCircuit(transaction, input.clinicId);
        await setClinicContext(transaction, input.clinicId);
        const current = await readSnapshot(transaction, input.clinicId);
        const evaluation = evaluateWhatsAppOperationsTraffic(current);
        if (!evaluation.allowed) {
          throw new WhatsAppRealTrafficBlockedError(evaluation.blockers);
        }
        if (current.trafficStatus === "enabled") return current;
        const [updated] = await transaction
          .update(whatsappConnections)
          .set({
            realTrafficEnabledAt: input.now,
            realTrafficEnabledByIdentityId: input.actorIdentityId,
            realTrafficStatus: "enabled",
            updatedAt: input.now,
          })
          .where(
            and(
              eq(whatsappConnections.clinicId, input.clinicId),
              eq(whatsappConnections.status, "ready"),
              eq(whatsappConnections.realTrafficStatus, "blocked"),
            ),
          )
          .returning({ clinicId: whatsappConnections.clinicId });
        if (updated === undefined) {
          throw new Error(
            "La Conexión cambió mientras se habilitaba el tráfico real; vuelva a verificar los gates",
          );
        }
        await insertApoloAudit(transaction, {
          action: "whatsapp-real-traffic-enabled",
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          occurredAt: input.now,
        });
        return readSnapshot(transaction, input.clinicId);
      },
    );
  },

  async revertRealTraffic(input) {
    return inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        await lockWhatsAppCircuit(transaction, input.clinicId);
        await setClinicContext(transaction, input.clinicId);
        const [updated] = await transaction
          .update(whatsappConnections)
          .set({
            realTrafficEnabledAt: null,
            realTrafficEnabledByIdentityId: null,
            realTrafficStatus: "blocked",
            updatedAt: input.now,
          })
          .where(
            and(
              eq(whatsappConnections.clinicId, input.clinicId),
              eq(whatsappConnections.realTrafficStatus, "enabled"),
            ),
          )
          .returning({ clinicId: whatsappConnections.clinicId });
        if (updated === undefined) {
          throw new Error("La Conexión no tiene tráfico real habilitado");
        }
        await openWhatsAppCircuitInTransaction(transaction, {
          actorIdentityId: input.actorIdentityId,
          actorKind: "superadmin",
          cause: "legal-block",
          clinicId: input.clinicId,
          now: input.now,
          reason: input.reason,
        });
        await insertApoloAudit(transaction, {
          action: "whatsapp-real-traffic-reverted",
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          occurredAt: input.now,
        });
        return readSnapshot(transaction, input.clinicId);
      },
    );
  },

  async startOffboarding(input) {
    return inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        await lockWhatsAppCircuit(transaction, input.clinicId);
        await setClinicContext(transaction, input.clinicId);
        const snapshot = await readSnapshot(transaction, input.clinicId);
        if (snapshot.offboardingAuthorization === null) {
          throw new Error("La Clínica no autorizó retirar la Conexión");
        }
        const currentGeneration =
          snapshot.connection?.provisioningEventId ?? null;
        const existingRunById =
          await transaction.query.whatsappOffboardingRuns.findFirst({
            where: and(
              eq(whatsappOffboardingRuns.clinicId, input.clinicId),
              eq(whatsappOffboardingRuns.id, input.runId),
            ),
          });
        if (
          existingRunById !== undefined &&
          existingRunById.provisioningEventId !== currentGeneration
        ) {
          throw new Error(
            "El runId de offboarding pertenece a otra generación de la Conexión",
          );
        }
        const generationRuns =
          await transaction.query.whatsappOffboardingRuns.findMany({
            orderBy: desc(whatsappOffboardingRuns.startedAt),
            where: eq(whatsappOffboardingRuns.clinicId, input.clinicId),
          });
        const existingGenerationRun = generationRuns.find(
          (run) => run.provisioningEventId === currentGeneration,
        );
        const existingRun = existingRunById ?? existingGenerationRun;
        const effectiveRunId = existingRun?.id ?? input.runId;
        await assertProvisioningGenerationBelongsToClinic(
          transaction,
          input.clinicId,
          currentGeneration,
        );
        const configurationExport = buildAllowedConfiguration(snapshot);
        if (existingRun === undefined) {
          await transaction.insert(whatsappOffboardingRuns).values({
            actorIdentityId: input.actorIdentityId,
            clinicId: input.clinicId,
            configurationExport,
            id: effectiveRunId,
            provisioningEventId: currentGeneration,
            startedAt: input.now,
            status: "running",
          });
        }
        const previousSteps =
          existingRun !== undefined
            ? await readOffboardingSteps(transaction, effectiveRunId)
            : snapshot.offboarding?.provisioningEventId === currentGeneration
              ? (snapshot.offboarding.steps ?? [])
              : [];
        const alreadyRunning = existingRun?.status === "running";
        if (alreadyRunning) {
          return {
            allowedConfiguration: configurationExport,
            alreadyDisconnected: snapshot.connection?.status === "disconnected",
            alreadyRunning,
            alreadyTrafficOff: snapshot.trafficStatus === "offboarded",
            phoneNumberId: snapshot.connection?.phoneNumberId ?? null,
            phoneNumberWebhookId:
              snapshot.connection?.phoneNumberWebhookId ?? null,
            previousSteps,
            provisioningEventId:
              existingRun?.provisioningEventId ?? currentGeneration,
            projectWebhookId: snapshot.connection?.projectWebhookId ?? null,
            runId: effectiveRunId,
            setupLinks: snapshot.setupLinks,
          } satisfies WhatsAppOffboardingStart;
        }
        if (snapshot.connection !== null) {
          const persistedConnection =
            await transaction.query.whatsappConnections.findFirst({
              columns: { metadata: true },
              where: eq(whatsappConnections.clinicId, input.clinicId),
            });
          await transaction
            .update(whatsappConnections)
            .set({
              metadata: publicWhatsAppConnectionMetadata({
                ...(persistedConnection?.metadata ?? {}),
                nextAction:
                  "Reconectar WhatsApp explícitamente para habilitar otra generación",
                statusReason: OFFBOARDING_REASON,
              }),
              realTrafficEnabledAt: null,
              realTrafficEnabledByIdentityId: null,
              realTrafficStatus: "offboarded",
              status: "disconnected",
              updatedAt: input.now,
            })
            .where(eq(whatsappConnections.clinicId, input.clinicId));
        }
        await insertApoloAudit(transaction, {
          action: "whatsapp-offboarding-started",
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          occurredAt: input.now,
        });
        return {
          allowedConfiguration: configurationExport,
          alreadyRunning,
          alreadyDisconnected: snapshot.connection?.status === "disconnected",
          alreadyTrafficOff: snapshot.trafficStatus === "offboarded",
          phoneNumberId: snapshot.connection?.phoneNumberId ?? null,
          phoneNumberWebhookId:
            snapshot.connection?.phoneNumberWebhookId ?? null,
          previousSteps,
          provisioningEventId:
            existingRun?.provisioningEventId ??
            snapshot.connection?.provisioningEventId ??
            null,
          projectWebhookId: snapshot.connection?.projectWebhookId ?? null,
          runId: effectiveRunId,
          setupLinks: snapshot.setupLinks,
        } satisfies WhatsAppOffboardingStart;
      },
    );
  },

  async recordOffboardingStep(input) {
    await inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        await setClinicContext(transaction, input.clinicId);
        await transaction.insert(whatsappOffboardingStepAudits).values({
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          effect: input.step.effect,
          evidence: sanitizeEvidence(input.step.evidence),
          message: sanitizeWhatsAppOperationalText(input.step.message),
          runId: input.runId,
          status: input.step.status,
          step: input.step.code,
        });
      },
    );
  },

  async markSetupLinkRevoked(input) {
    await inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        await setClinicContext(transaction, input.clinicId);
        await transaction
          .update(whatsappSetupLinks)
          .set({
            providerError: null,
            providerStatus: "completed",
            revokedAt: input.now,
            status: "revoked",
            updatedAt: input.now,
          })
          .where(
            and(
              eq(whatsappSetupLinks.clinicId, input.clinicId),
              eq(whatsappSetupLinks.id, input.setupLinkId),
            ),
          );
      },
    );
  },

  async finishOffboarding(input) {
    return inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        await setClinicContext(transaction, input.clinicId);
        await transaction
          .update(whatsappOffboardingRuns)
          .set({
            completedAt: input.now,
            configurationExport: input.configurationExport,
            status: input.status,
          })
          .where(
            and(
              eq(whatsappOffboardingRuns.clinicId, input.clinicId),
              eq(whatsappOffboardingRuns.id, input.runId),
            ),
          );
        await insertApoloAudit(transaction, {
          action:
            input.status === "completed"
              ? "whatsapp-offboarding-completed"
              : "whatsapp-offboarding-failed",
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          occurredAt: input.now,
        });
        const snapshot = await readSnapshot(transaction, input.clinicId);
        if (snapshot.offboarding === null) {
          throw new Error("No se pudo leer la evidencia del offboarding");
        }
        return snapshot.offboarding;
      },
    );
  },
};

async function readSnapshot(
  transaction: ClinicTransaction,
  clinicId: string,
): Promise<WhatsAppOperationsSnapshot> {
  const clinic = await transaction.query.clinics.findFirst({
    columns: { id: true, isSynthetic: true, name: true },
    where: eq(clinics.id, clinicId),
  });
  if (clinic === undefined) throw new Error("La Clínica no existe");

  const [
    connection,
    readiness,
    circuit,
    gateRows,
    smoke,
    offboarding,
    setupLinks,
    templates,
    billing,
  ] = await Promise.all([
    transaction.query.whatsappConnections.findFirst({
      where: eq(whatsappConnections.clinicId, clinicId),
    }),
    transaction.query.whatsappReadiness.findFirst({
      where: eq(whatsappReadiness.clinicId, clinicId),
    }),
    transaction.query.whatsappCircuitBreakers.findFirst({
      columns: { status: true },
      where: eq(whatsappCircuitBreakers.clinicId, clinicId),
    }),
    transaction.query.whatsappTrafficGateEvidences.findMany({
      where: eq(whatsappTrafficGateEvidences.clinicId, clinicId),
    }),
    transaction
      .select()
      .from(whatsappSmokeRuns)
      .where(eq(whatsappSmokeRuns.clinicId, clinicId))
      .orderBy(desc(whatsappSmokeRuns.finishedAt))
      .limit(1),
    transaction
      .select()
      .from(whatsappOffboardingRuns)
      .where(eq(whatsappOffboardingRuns.clinicId, clinicId))
      .orderBy(desc(whatsappOffboardingRuns.startedAt))
      .limit(1),
    transaction.query.whatsappSetupLinks.findMany({
      where: and(
        eq(whatsappSetupLinks.clinicId, clinicId),
        eq(whatsappSetupLinks.status, "active"),
      ),
    }),
    transaction.query.whatsappCriticalTemplates.findMany({
      where: eq(whatsappCriticalTemplates.clinicId, clinicId),
    }),
    transaction.query.whatsappBilling.findFirst({
      where: eq(whatsappBilling.clinicId, clinicId),
    }),
  ]);
  const latestSmoke = smoke[0];
  const latestOffboarding = offboarding[0];
  const offboardingSteps =
    latestOffboarding === undefined
      ? []
      : await readOffboardingSteps(transaction, latestOffboarding.id);
  const blockers = readinessBlockers(connection, readiness, templates, billing);
  const technicalStatus =
    connection?.status === "disconnected" || blockers.length > 0
      ? "blocked"
      : (readiness?.technicalStatus ?? "pending");

  return {
    circuitStatus: circuit?.status ?? "closed",
    clinicId: clinic.id,
    clinicIsSynthetic: clinic.isSynthetic,
    clinicName: clinic.name,
    connection:
      connection === undefined
        ? null
        : {
            businessAccountId: connection.businessAccountId,
            connectionType: connection.connectionType,
            customer: connection.customer,
            phoneNumberE164: connection.phoneNumberE164,
            phoneNumberId: connection.phoneNumberId,
            phoneNumberWebhookId: readiness?.phoneNumberWebhookId ?? null,
            provisioningEventId:
              connection.metadata.provisioningEventId ?? null,
            projectId: readiness?.projectId ?? null,
            projectWebhookId: readiness?.projectWebhookId ?? null,
            provider: connection.provider,
            status: connection.status,
            updatedAt: connection.updatedAt,
          },
    gates: Object.fromEntries(
      gateRows.map((row) => [
        row.code,
        {
          evidenceReference: row.evidenceReference,
          ready: row.ready,
          recordedAt: row.recordedAt,
        },
      ]),
    ),
    latestSmoke:
      latestSmoke === undefined
        ? null
        : {
            blockers: latestSmoke.blockers,
            evidence: latestSmoke.evidence,
            finishedAt: latestSmoke.finishedAt,
            id: latestSmoke.id,
            provisioningEventId: latestSmoke.provisioningEventId,
            providerTransportVerified: latestSmoke.providerTransportVerified,
            realPatientsEnabled: latestSmoke.realPatientsEnabled,
            startedAt: latestSmoke.startedAt,
            status: latestSmoke.status,
            steps: latestSmoke.steps,
            syntheticContact: latestSmoke.syntheticContact,
          },
    offboarding:
      latestOffboarding === undefined
        ? null
        : {
            configurationExport: latestOffboarding.configurationExport,
            provisioningEventId: latestOffboarding.provisioningEventId,
            runId: latestOffboarding.id,
            status: latestOffboarding.status,
            steps: offboardingSteps,
          },
    offboardingAuthorization:
      connection?.offboardingAuthorizedAt !== null &&
      connection?.offboardingAuthorizedAt !== undefined &&
      connection.offboardingAuthorizedByIdentityId !== null
        ? {
            authorizedAt: connection.offboardingAuthorizedAt,
            authorizedByIdentityId:
              connection.offboardingAuthorizedByIdentityId,
          }
        : null,
    setupLinks: setupLinks.map((link) => ({
      customerId: link.customerId,
      id: link.id,
      kapsoSetupLinkId: link.kapsoSetupLinkId,
      status: link.status,
    })),
    technicalReadiness: {
      blockers,
      status: technicalStatus,
    },
    trafficStatus: connection?.realTrafficStatus ?? "blocked",
  };
}

async function readOffboardingSteps(
  transaction: ClinicTransaction,
  runId: string,
): Promise<WhatsAppOperationsOffboardingStep[]> {
  const rows = await transaction
    .select()
    .from(whatsappOffboardingStepAudits)
    .where(eq(whatsappOffboardingStepAudits.runId, runId))
    .orderBy(whatsappOffboardingStepAudits.occurredAt);
  return rows.map((row) => ({
    code: row.step,
    effect: row.effect,
    evidence: row.evidence,
    message: row.message,
    status: row.status,
  }));
}

function readinessBlockers(
  connection: typeof whatsappConnections.$inferSelect | undefined,
  readiness: typeof whatsappReadiness.$inferSelect | undefined,
  templates: Array<typeof whatsappCriticalTemplates.$inferSelect>,
  billing: typeof whatsappBilling.$inferSelect | undefined,
) {
  const blockers: string[] = [];
  if (connection === undefined) {
    blockers.push("No existe una Conexión de WhatsApp");
  }
  if (readiness === undefined) {
    blockers.push("Readiness aún no ejecutado");
  } else {
    const billingStatus =
      readiness.billingSyncStatus === "failed" || billing?.status === "failed"
        ? "failed"
        : readiness.billingSyncStatus === "ready" && billing?.status === "ready"
          ? "ready"
          : "pending";
    const result = evaluateWhatsAppReadiness({
      billing: {
        alertThresholdCents: billing?.alertThresholdCents ?? null,
        chargesSeparated: billing?.chargesSeparated ?? false,
        consumedCents: billing?.consumedCents ?? 0,
        creditCents: billing?.creditCents ?? 0,
        creditLimitCents: billing?.creditLimitCents ?? null,
        creditReserveCents: billing?.creditReserveCents ?? null,
        estimatedDailyConsumptionCents:
          billing?.estimatedDailyConsumptionCents ?? 0,
        warningBalancePercent: billing?.warningBalancePercent ?? 20,
        criticalBalancePercent: billing?.criticalBalancePercent ?? 10,
        warningAutonomyDays: billing?.warningAutonomyDays ?? 7,
        criticalAutonomyDays: billing?.criticalAutonomyDays ?? 3,
        kapsoMonthlyQuota: billing?.kapsoMonthlyQuota ?? null,
        kapsoQuotaPeriod: billing?.kapsoQuotaPeriod ?? null,
        kapsoQuotaConsumed: billing?.kapsoQuotaConsumed ?? 0,
        kapsoQuotaReserved: billing?.kapsoQuotaReserved ?? 0,
        metaChargesCents: billing?.metaChargesCents ?? null,
        mode: billing?.mode ?? "unknown",
        platformChargesCents: billing?.platformChargesCents ?? null,
        status: billingStatus,
      },
      connection: {
        businessAccountId:
          connection?.businessAccountId ?? readiness.businessAccountId,
        connectionType: connection?.connectionType ?? "simulated",
        phoneNumberId: connection?.phoneNumberId ?? readiness.phoneNumberId,
        provider: connection?.provider ?? "simulated",
        status: connection?.status ?? "disconnected",
      },
      e2e: {
        evidence: readiness.e2eEvidence,
        evidenceScope: readiness.e2eEvidenceScope,
        lastTestAt: readiness.e2eLastTestAt,
        status: readiness.e2eStatus,
      },
      number: {
        environment: readiness.numberEnvironment,
        health: readiness.numberHealth,
        healthCheckedAt: readiness.numberHealthCheckedAt,
      },
      now: new Date(),
      templatesSync: { status: readiness.templatesSyncStatus },
      templates: templates.map((template) => ({
        category: template.category,
        catalogVersion: template.catalogVersion,
        content: template.content,
        examples: template.examples,
        kind: template.kind,
        locale: template.locale,
        name: template.name,
        providerTemplateId: template.providerTemplateId,
        provisioningStatus: template.provisioningStatus,
        rejectionReason: template.rejectionReason,
        status: template.status,
        syncedAt: template.syncedAt,
        variables: template.variables,
      })),
      webhooks: {
        phoneNumber: { status: readiness.phoneNumberWebhookStatus },
        project: { status: readiness.projectWebhookStatus },
      },
    });
    blockers.push(
      ...result.gates
        .filter((gate) => gate.status !== "ready")
        .map((gate) => gate.message),
    );
    if (readiness.technicalStatus !== "ready") {
      blockers.push(readiness.statusReason);
    }

    if (readiness.businessAccountId === null) {
      blockers.push("WABA no confirmado en el readiness actual");
    }
    if (readiness.phoneNumberId === null) {
      blockers.push("Número de WhatsApp no confirmado en el readiness actual");
    }
    if (
      readiness.projectId === null ||
      readiness.provisioningEventId === null
    ) {
      blockers.push("La generación de provisión de WhatsApp está incompleta");
    }
    if (
      readiness.projectWebhookId === null ||
      readiness.phoneNumberWebhookId === null
    ) {
      blockers.push("Faltan identificadores de webhooks de Praxia");
    }
    if (
      connection !== undefined &&
      (connection.businessAccountId !== readiness.businessAccountId ||
        connection.phoneNumberId !== readiness.phoneNumberId ||
        (connection.metadata.projectId ?? null) !== readiness.projectId ||
        (connection.metadata.provisioningEventId ?? null) !==
          readiness.provisioningEventId ||
        connection.metadata.health !== "healthy" ||
        connection.metadata.webhookStatus !== "ready")
    ) {
      blockers.push(
        "La Conexión y el readiness no pertenecen a la misma generación lista",
      );
    }
  }
  return [...new Set(blockers.filter((blocker) => blocker.trim() !== ""))];
}

function buildAllowedConfiguration(snapshot: WhatsAppOperationsSnapshot) {
  return {
    schemaVersion: 1,
    clinic: { id: snapshot.clinicId, name: snapshot.clinicName },
    connection:
      snapshot.connection === null
        ? null
        : {
            businessAccountId: snapshot.connection.businessAccountId,
            connectionType: snapshot.connection.connectionType,
            customer: snapshot.connection.customer,
            phoneNumberE164: snapshot.connection.phoneNumberE164,
            phoneNumberId: snapshot.connection.phoneNumberId,
            provider: snapshot.connection.provider,
          },
    readiness: {
      projectId: snapshot.connection?.projectId ?? null,
      projectWebhookConfigured: snapshot.connection?.projectWebhookId != null,
      phoneNumberWebhookConfigured:
        snapshot.connection?.phoneNumberWebhookId != null,
    },
    setupLinks: { activeCount: snapshot.setupLinks.length },
  } satisfies Record<string, unknown>;
}

/**
 * A generation is owned by a Clinic through its durable provisioning steps.
 * Readiness is also accepted for an in-progress current generation, while the
 * step history keeps evidence valid after readiness moves to a reconnection.
 */
async function assertProvisioningGenerationBelongsToClinic(
  transaction: ClinicTransaction,
  clinicId: string,
  provisioningEventId: string | null,
) {
  if (provisioningEventId === null) return;

  const ownedStep = await transaction.query.whatsappProvisioningSteps.findFirst(
    {
      columns: { id: true },
      where: and(
        eq(whatsappProvisioningSteps.clinicId, clinicId),
        eq(whatsappProvisioningSteps.eventId, provisioningEventId),
      ),
    },
  );
  if (ownedStep !== undefined) return;

  const currentReadiness = await transaction.query.whatsappReadiness.findFirst({
    columns: { provisioningEventId: true },
    where: eq(whatsappReadiness.clinicId, clinicId),
  });
  if (currentReadiness?.provisioningEventId === provisioningEventId) return;

  throw new Error(
    "La generación de provisión de WhatsApp no pertenece a la Clínica",
  );
}

async function setClinicContext(
  transaction: ClinicTransaction,
  clinicId: string,
) {
  await transaction.execute(
    sql`select set_config('app.clinic_id', ${clinicId}, true)`,
  );
}

async function insertApoloAudit(
  transaction: ClinicTransaction,
  input: {
    action: string;
    actorIdentityId: string;
    clinicId: string;
    occurredAt: Date;
  },
) {
  await transaction.insert(apoloAuditEvents).values(input);
}

function sanitizeEvidence(value: string | null) {
  return value === null ? null : sanitizeWhatsAppOperationalText(value);
}

function buildSmokeEvidence(
  result: ReturnType<typeof sanitizeWhatsAppSyntheticSmokeResult>,
) {
  return sanitizeEvidence(
    result.evidence ??
      (result.blockers.length === 0
        ? "Smoke sintético completo"
        : result.blockers.map((blocker) => blocker.message).join("; ")),
  );
}

async function blockUnsafeRealTraffic(
  transaction: ClinicTransaction,
  snapshot: WhatsAppOperationsSnapshot,
  input: { actorIdentityId: string; clinicId: string; now: Date },
) {
  const evaluation = evaluateWhatsAppOperationsTraffic(snapshot);
  if (snapshot.trafficStatus !== "enabled" || evaluation.allowed) {
    return;
  }

  const reason = evaluation.blockers
    .map((blocker) => blocker.message)
    .join("; ");
  await openWhatsAppCircuitInTransaction(transaction, {
    actorIdentityId: input.actorIdentityId,
    actorKind: "superadmin",
    cause: "legal-block",
    clinicId: input.clinicId,
    now: input.now,
    reason: reason || "El gate de tráfico real dejó de ser seguro",
  });
  await transaction
    .update(whatsappConnections)
    .set({
      realTrafficEnabledAt: null,
      realTrafficEnabledByIdentityId: null,
      realTrafficStatus: "blocked",
      updatedAt: input.now,
    })
    .where(
      and(
        eq(whatsappConnections.clinicId, input.clinicId),
        eq(whatsappConnections.realTrafficStatus, "enabled"),
      ),
    );
  await insertApoloAudit(transaction, {
    action: "whatsapp-real-traffic-auto-blocked",
    actorIdentityId: input.actorIdentityId,
    clinicId: input.clinicId,
    occurredAt: input.now,
  });
}
