import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { sanitizeWhatsAppOperationalText } from "~/domain/whatsapp-circuit-breaker";
import {
  expireWhatsAppSyntheticSmoke,
  sanitizeWhatsAppSyntheticSmokeResult,
} from "~/domain/whatsapp-smoke";
import { whatsappOffboardingDeliverySuppressionReason } from "~/domain/whatsapp-offboarding";
import {
  evaluateWhatsAppReadiness,
  isWhatsAppNumberMessagingAvailable,
} from "~/domain/whatsapp-readiness";
import {
  inSuperadminTransaction,
  inSuperadminRlsTransaction,
  lockWhatsAppCircuit,
  inClinicTransaction,
  type ClinicTransaction,
} from "~/server/db/clinic-context";
import { openWhatsAppCircuitInTransaction } from "~/server/db/whatsapp-circuit-breaker-store";
import { isWhatsAppSmokeContactEligibleInTransaction } from "~/server/db/whatsapp-smoke-contact";
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
  contacts,
  whatsappBilling,
  whatsappCircuitBreakers,
  whatsappConnections,
  whatsappCriticalTemplates,
  transactionalDeliveries,
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
import {
  persistSmokeResult,
  smokeResultFromRow,
} from "~/server/db/whatsapp-smoke-run-store";

const OFFBOARDING_REASON = "Offboarding explícito de la Conexión de WhatsApp";
const OFFBOARDING_RUN_LEASE_MS = 2 * 60_000;

export const drizzleWhatsAppOperationsStore: WhatsAppOperationsStore = {
  async read(input) {
    return inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        const snapshot = await readSnapshot(transaction, input.clinicId);
        const smoke = snapshot.latestSmoke;
        const now = new Date();
        if (
          smoke?.status !== "pending" ||
          smoke.timeoutAt === null ||
          smoke.timeoutAt === undefined ||
          smoke.timeoutAt > now
        ) {
          return snapshot;
        }
        const [run] = await transaction
          .select()
          .from(whatsappSmokeRuns)
          .where(
            and(
              eq(whatsappSmokeRuns.clinicId, input.clinicId),
              eq(whatsappSmokeRuns.id, smoke.id),
              eq(whatsappSmokeRuns.status, "pending"),
            ),
          )
          .for("update");
        if (run === undefined) return readSnapshot(transaction, input.clinicId);
        const expired = expireWhatsAppSyntheticSmoke(
          smokeResultFromRow(run),
          now,
        );
        await persistSmokeResult(transaction, {
          clinicId: input.clinicId,
          finishedAt: now,
          result: expired,
          runId: smoke.id,
        });
        await insertApoloAudit(transaction, {
          action: "whatsapp-synthetic-smoke-failed",
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          occurredAt: now,
        });
        return readSnapshot(transaction, input.clinicId);
      },
    );
  },

  async resolveSyntheticSmokeContact(input) {
    return inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        await setClinicContext(transaction, input.clinicId);
        const contact = await transaction.query.contacts.findFirst({
          columns: { id: true },
          where: and(
            eq(contacts.clinicId, input.clinicId),
            eq(contacts.phoneE164, input.phoneE164),
          ),
        });
        if (contact === undefined) {
          throw new Error(
            "El teléfono indicado no pertenece a un Contacto de esta Clínica",
          );
        }
        const eligible = await isWhatsAppSmokeContactEligibleInTransaction(
          transaction,
          { clinicId: input.clinicId, contactId: contact.id },
        );
        if (!eligible) {
          throw new Error(
            "El Contacto de prueba está vinculado a un Paciente real y no se puede usar",
          );
        }
        return { id: contact.id, maskedPhone: maskPhone(input.phoneE164) };
      },
    );
  },

  async createWhatsAppTestContact(input) {
    return inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        await setClinicContext(transaction, input.clinicId);
        const duplicate = await transaction.query.contacts.findFirst({
          columns: { id: true },
          where: and(
            eq(contacts.clinicId, input.clinicId),
            eq(contacts.phoneE164, input.phoneE164),
          ),
        });
        if (duplicate !== undefined) {
          throw new Error(
            "Ya existe un Contacto con ese teléfono en la Clínica seleccionada",
          );
        }
        const [contact] = await transaction
          .insert(contacts)
          .values({
            clinicId: input.clinicId,
            name: input.name,
            phoneE164: input.phoneE164,
          })
          .returning({
            id: contacts.id,
            name: contacts.name,
            phoneE164: contacts.phoneE164,
          });
        if (contact === undefined) {
          throw new Error("No se pudo crear el Contacto de prueba");
        }
        const phoneE164 = contact.phoneE164;
        if (phoneE164 === null) {
          throw new Error("El Contacto de prueba no tiene un teléfono");
        }
        await insertApoloAudit(transaction, {
          action: "whatsapp-test-contact-created",
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          occurredAt: new Date(),
        });
        return {
          ...contact,
          phoneE164,
          maskedPhone: maskPhone(phoneE164),
        };
      },
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
        if (result.status === "pending") {
          const [pendingRun] = await transaction
            .select({ id: whatsappSmokeRuns.id })
            .from(whatsappSmokeRuns)
            .where(
              and(
                eq(whatsappSmokeRuns.clinicId, input.clinicId),
                eq(whatsappSmokeRuns.status, "pending"),
              ),
            )
            .for("update");
          if (pendingRun !== undefined && pendingRun.id !== input.runId) {
            throw new Error("Ya hay un smoke real pendiente para esta Clínica");
          }
        }
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
            createdAt: input.startedAt,
            evidence,
            finishedAt: input.finishedAt,
            id: input.runId,
            provisioningEventId: input.provisioningEventId,
            providerTransportVerified:
              result.providerTransportVerified === true,
            requiresRealRoundtrip: result.requireRealRoundtrip === true,
            realPatientsEnabled: result.realPatientsEnabled,
            testContactId: result.testContactId ?? null,
            testContactMaskedPhone: result.testContactMaskedPhone ?? null,
            timeoutAt: result.timeoutAt ?? null,
            timedOutAt: result.timedOutAt ?? null,
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
              requiresRealRoundtrip: result.requireRealRoundtrip === true,
              realPatientsEnabled: result.realPatientsEnabled,
              testContactId: result.testContactId ?? null,
              testContactMaskedPhone: result.testContactMaskedPhone ?? null,
              timeoutAt: result.timeoutAt ?? null,
              timedOutAt: result.timedOutAt ?? null,
              status: result.status,
              steps: result.steps,
              syntheticContact: result.syntheticContact,
            },
          });
        await insertApoloAudit(transaction, {
          action:
            result.requireRealRoundtrip === true
              ? result.status === "pending"
                ? "whatsapp-transport-roundtrip-started"
                : `whatsapp-transport-roundtrip-${result.status}`
              : result.status === "pending"
                ? "whatsapp-synthetic-smoke-started"
                : `whatsapp-synthetic-smoke-${result.status}`,
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          occurredAt: input.finishedAt ?? input.startedAt,
        });
        const snapshot = await readSnapshot(transaction, input.clinicId);
        await blockUnsafeRealTraffic(transaction, snapshot, {
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          now: input.finishedAt ?? input.startedAt,
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
    return inSuperadminRlsTransaction(
      input.actorIdentityId,
      async (transaction) => {
        await lockWhatsAppCircuit(transaction, input.clinicId);
        await setClinicContext(transaction, input.clinicId);
        await transaction.execute(
          sql`select set_config('app.whatsapp_offboarding', 'true', true)`,
        );
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
        const configurationExport =
          existingRun?.configurationExport ??
          buildAllowedConfiguration(snapshot);
        const previousSteps =
          existingRun !== undefined
            ? await readOffboardingSteps(transaction, effectiveRunId)
            : snapshot.offboarding?.provisioningEventId === currentGeneration
              ? (snapshot.offboarding.steps ?? [])
              : [];
        const alreadyCompleted = existingRun?.status === "completed";
        const alreadyRunning =
          existingRun?.status === "running" &&
          existingRun.leaseExpiresAt !== null &&
          existingRun.leaseExpiresAt > input.now;
        const cancelledPendingDeliveries =
          existingRun === undefined
            ? 0
            : await countOffboardingSuppressedDeliveries(transaction, {
                clinicId: input.clinicId,
                startedAt: existingRun.startedAt,
              });
        if (alreadyCompleted || alreadyRunning) {
          return {
            allowedConfiguration: configurationExport,
            alreadyCompleted,
            alreadyDisconnected: snapshot.connection?.status === "disconnected",
            alreadyRunning,
            alreadyTrafficOff: snapshot.trafficStatus === "offboarded",
            cancelledPendingDeliveries,
            leaseToken: existingRun?.leaseToken ?? input.leaseToken,
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

        if (existingRun === undefined) {
          await transaction.insert(whatsappOffboardingRuns).values({
            actorIdentityId: input.actorIdentityId,
            clinicId: input.clinicId,
            configurationExport,
            id: effectiveRunId,
            leaseExpiresAt: new Date(
              input.now.valueOf() + OFFBOARDING_RUN_LEASE_MS,
            ),
            leaseToken: input.leaseToken,
            provisioningEventId: currentGeneration,
            startedAt: input.now,
            status: "running",
          });
        } else {
          await transaction
            .update(whatsappOffboardingRuns)
            .set({
              completedAt: null,
              leaseExpiresAt: new Date(
                input.now.valueOf() + OFFBOARDING_RUN_LEASE_MS,
              ),
              leaseToken: input.leaseToken,
              status: "running",
            })
            .where(
              and(
                eq(whatsappOffboardingRuns.clinicId, input.clinicId),
                eq(whatsappOffboardingRuns.id, effectiveRunId),
              ),
            );
        }

        await openWhatsAppCircuitInTransaction(transaction, {
          actorIdentityId: input.actorIdentityId,
          actorKind: "superadmin",
          cause: "webhook-paused",
          clinicId: input.clinicId,
          now: input.now,
          reason: OFFBOARDING_REASON,
        });

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

        await transaction
          .update(transactionalDeliveries)
          .set({
            lastError: whatsappOffboardingDeliverySuppressionReason,
            leaseExpiresAt: null,
            status: "suppressed",
            updatedAt: input.now,
          })
          .where(
            and(
              eq(transactionalDeliveries.clinicId, input.clinicId),
              inArray(transactionalDeliveries.kind, [
                "appointment-message",
                "appointment-reminder",
              ]),
              or(
                eq(transactionalDeliveries.status, "pending"),
                and(
                  eq(transactionalDeliveries.status, "processing"),
                  or(
                    isNull(transactionalDeliveries.leaseExpiresAt),
                    lte(transactionalDeliveries.leaseExpiresAt, input.now),
                  ),
                ),
              ),
            ),
          );
        const suppressedCount = await countOffboardingSuppressedDeliveries(
          transaction,
          {
            clinicId: input.clinicId,
            startedAt: existingRun?.startedAt ?? input.now,
          },
        );

        if (existingRun === undefined) {
          await insertApoloAudit(transaction, {
            action: "whatsapp-offboarding-started",
            actorIdentityId: input.actorIdentityId,
            clinicId: input.clinicId,
            occurredAt: input.now,
          });
        }
        return {
          allowedConfiguration: configurationExport,
          alreadyCompleted: false,
          alreadyRunning: false,
          alreadyDisconnected: snapshot.connection?.status === "disconnected",
          alreadyTrafficOff: snapshot.trafficStatus === "offboarded",
          cancelledPendingDeliveries: suppressedCount,
          leaseToken: input.leaseToken,
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
        await renewOffboardingRunLease(transaction, input);
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
        await renewOffboardingRunLease(transaction, input);
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
        const [finished] = await transaction
          .update(whatsappOffboardingRuns)
          .set({
            completedAt: input.now,
            configurationExport: input.configurationExport,
            leaseExpiresAt: null,
            leaseToken: null,
            status: input.status,
          })
          .where(
            and(
              eq(whatsappOffboardingRuns.clinicId, input.clinicId),
              eq(whatsappOffboardingRuns.id, input.runId),
              eq(whatsappOffboardingRuns.leaseToken, input.leaseToken),
              eq(whatsappOffboardingRuns.status, "running"),
            ),
          )
          .returning({ id: whatsappOffboardingRuns.id });
        if (finished === undefined) {
          throw new Error(
            "La concesión del offboarding venció antes del cierre",
          );
        }
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
      .orderBy(desc(whatsappSmokeRuns.startedAt))
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
  const blockers = readinessBlockers(
    connection,
    readiness,
    templates,
    billing,
    circuit?.status === "open",
  );
  const technicalStatus =
    connection?.status === "disconnected" || blockers.length > 0
      ? "blocked"
      : circuit?.status === "open" && connection?.status === "blocked"
        ? "ready"
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
            ...smokeResultFromRow(latestSmoke),
            finishedAt: latestSmoke.finishedAt,
            id: latestSmoke.id,
            provisioningEventId: latestSmoke.provisioningEventId,
            startedAt: latestSmoke.startedAt,
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
  allowCircuitRecovery = false,
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
        creditBalanceKnown: billing?.creditBalanceKnown ?? false,
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
        kapsoFundingReason: billing?.kapsoFundingReason ?? null,
        kapsoFundingStatus: billing?.kapsoFundingStatus ?? null,
        kapsoPaidMessagesPaused: billing?.kapsoPaidMessagesPaused ?? null,
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
      allowConnectionRecovery: allowCircuitRecovery,
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
        .filter((gate) => gate.code !== "e2e" && gate.status !== "ready")
        .map((gate) => gate.message),
    );
    if (
      readiness.technicalStatus !== "ready" &&
      !(allowCircuitRecovery && connection?.status === "blocked")
    ) {
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
        !isWhatsAppNumberMessagingAvailable(connection.metadata.health) ||
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

async function countOffboardingSuppressedDeliveries(
  transaction: ClinicTransaction,
  input: { clinicId: string; startedAt: Date },
) {
  const [result] = await transaction
    .select({ count: count() })
    .from(transactionalDeliveries)
    .where(
      and(
        eq(transactionalDeliveries.clinicId, input.clinicId),
        inArray(transactionalDeliveries.kind, [
          "appointment-message",
          "appointment-reminder",
        ]),
        eq(transactionalDeliveries.status, "suppressed"),
        eq(
          transactionalDeliveries.lastError,
          whatsappOffboardingDeliverySuppressionReason,
        ),
        gte(transactionalDeliveries.updatedAt, input.startedAt),
      ),
    );
  return result?.count ?? 0;
}

async function renewOffboardingRunLease(
  transaction: ClinicTransaction,
  input: { clinicId: string; leaseToken: string; runId: string },
) {
  const [renewed] = await transaction
    .update(whatsappOffboardingRuns)
    .set({
      leaseExpiresAt: sql`now() + ${OFFBOARDING_RUN_LEASE_MS} * interval '1 millisecond'`,
    })
    .where(
      and(
        eq(whatsappOffboardingRuns.clinicId, input.clinicId),
        eq(whatsappOffboardingRuns.id, input.runId),
        eq(whatsappOffboardingRuns.leaseToken, input.leaseToken),
        eq(whatsappOffboardingRuns.status, "running"),
      ),
    )
    .returning({ id: whatsappOffboardingRuns.id });
  if (renewed === undefined) {
    throw new Error("La concesión del offboarding venció; vuelve a intentarlo");
  }
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

function maskPhone(phoneE164: string) {
  const digits = phoneE164.replace(/\D/g, "");
  return `+${"•".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
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
