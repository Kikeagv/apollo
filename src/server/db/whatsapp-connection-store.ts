import { and, desc, eq } from "drizzle-orm";

import {
  isWhatsAppConnectionReady,
  publicWhatsAppConnectionMetadata,
} from "~/domain/whatsapp-connection";
import {
  evaluateWhatsAppReadiness,
  isWhatsAppNumberMessagingAvailable,
  type WhatsAppReadinessInput,
} from "~/domain/whatsapp-readiness";
import { evaluateWhatsAppRealTraffic } from "~/domain/whatsapp-traffic";
import type { WhatsAppProviderId } from "~/domain/whatsapp-runtime";
import type { WhatsAppConnectionReader } from "~/server/application/whatsapp-connections";
import {
  WhatsAppCircuitBreakerOpenError,
  WhatsAppConnectionRequiredError,
  WhatsAppRealTrafficBlockedError,
} from "~/server/application/whatsapp-provider";
import {
  inClinicTransaction,
  inWhatsAppOutboundWorkerTransaction,
  inWhatsAppProviderTransaction,
  setWhatsAppWorkerClinicContext,
} from "~/server/db/clinic-context";
import { readWhatsAppConsentSnapshot } from "~/server/db/whatsapp-consent-query";
import {
  clinicUsers,
  contactPatientLinks,
  contacts,
  whatsappConnections,
  whatsappCircuitBreakers,
  whatsappBilling,
  whatsappCriticalTemplates,
  whatsappReadiness,
  clinics,
  whatsappSmokeRuns,
  whatsappTrafficGateEvidences,
} from "~/server/db/schema";

/** Lee la conexión sin sacar al operador del alcance RLS de su Clínica. */
export const drizzleWhatsAppConnectionReader: WhatsAppConnectionReader = {
  async read(input) {
    return inClinicTransaction(input, async (transaction) => {
      const membership = await transaction.query.clinicUsers.findFirst({
        columns: { id: true },
        where: and(
          eq(clinicUsers.clinicId, input.clinicId),
          eq(clinicUsers.identityId, input.identityId),
          eq(clinicUsers.active, true),
          eq(clinicUsers.role, "owner"),
        ),
      });
      if (membership === undefined) return undefined;

      const connection = await transaction.query.whatsappConnections.findFirst({
        where: eq(whatsappConnections.clinicId, input.clinicId),
      });
      return connection === undefined
        ? undefined
        : {
            ...connection,
            metadata: publicWhatsAppConnectionMetadata(connection.metadata),
          };
    });
  },
};

/** Verifica el estado y proveedor antes de cualquier envío externo. */
export async function requireWhatsAppConnectionReady(input: {
  clinicId: string;
  provider: WhatsAppProviderId;
}) {
  return requireWhatsAppConnection(input, true);
}

/**
 * Autoriza el único envío de prueba de plantilla sin habilitar tráfico real.
 * Conserva readiness técnico, generación vigente y circuito cerrado.
 */
export async function requireWhatsAppSmokeTemplateConnectionReady(input: {
  clinicId: string;
  provider: WhatsAppProviderId;
}) {
  return requireWhatsAppConnection(input, false);
}

/** Revalida el permiso del Contacto después de la espera de rate limit. */
export async function requireWhatsAppSmokeTemplateConsent(input: {
  clinicId: string;
  contactId: string;
  consentEvidence: {
    acceptedAt: Date;
    privacyVersion: string;
    reference: string;
    termsVersion: string;
    textReference: string;
  };
  now: Date;
  phoneE164: string;
}) {
  const allowed = await inWhatsAppOutboundWorkerTransaction(
    async (transaction) => {
      if (
        !(await setWhatsAppWorkerClinicContext(transaction, input.clinicId))
      ) {
        return false;
      }
      const [contact, patientLink] = await Promise.all([
        transaction.query.contacts.findFirst({
          columns: { phoneE164: true },
          where: and(
            eq(contacts.clinicId, input.clinicId),
            eq(contacts.id, input.contactId),
          ),
        }),
        transaction.query.contactPatientLinks.findFirst({
          columns: { id: true },
          where: and(
            eq(contactPatientLinks.clinicId, input.clinicId),
            eq(contactPatientLinks.contactId, input.contactId),
          ),
        }),
      ]);
      const consent = await readWhatsAppConsentSnapshot(transaction, {
        clinicId: input.clinicId,
        contactId: input.contactId,
        now: input.now,
        patientId: null,
      });
      return (
        contact?.phoneE164 === input.phoneE164 &&
        patientLink === undefined &&
        consent.decision === "allowed" &&
        consent.reference === input.consentEvidence.reference &&
        consent.acceptedAt?.valueOf() ===
          input.consentEvidence.acceptedAt.valueOf() &&
        consent.termsVersion === input.consentEvidence.termsVersion &&
        consent.privacyVersion === input.consentEvidence.privacyVersion &&
        consent.textReference === input.consentEvidence.textReference
      );
    },
  );
  if (!allowed) {
    throw new WhatsAppRealTrafficBlockedError([
      {
        code: "consent",
        message:
          "El Contacto de prueba ya no tiene el consentimiento vigente registrado para esta plantilla",
      },
    ]);
  }
}

/** Permite la única respuesta libre al desafío del smoke entrante. */
export async function requireWhatsAppSmokeReplyConnectionReady(input: {
  clinicId: string;
  idempotencyKey: string;
  provider: WhatsAppProviderId;
  recipientPhoneE164: string | null;
}) {
  const match = /^whatsapp-smoke:([0-9a-f-]{36}):reply$/i.exec(
    input.idempotencyKey,
  );
  if (match === null || input.provider !== "kapso") {
    throw new WhatsAppConnectionRequiredError();
  }
  const connection = await inWhatsAppProviderTransaction(
    input.clinicId,
    async (transaction) => {
      const current = await transaction.query.whatsappConnections.findFirst({
        where: and(
          eq(whatsappConnections.clinicId, input.clinicId),
          eq(whatsappConnections.provider, "kapso"),
        ),
      });
      if (
        current?.status !== "ready" ||
        current.phoneNumberId === null ||
        current.realTrafficStatus === "offboarded"
      ) {
        return undefined;
      }
      const [circuit, latestRun] = await Promise.all([
        transaction.query.whatsappCircuitBreakers.findFirst({
          where: eq(whatsappCircuitBreakers.clinicId, input.clinicId),
        }),
        transaction
          .select()
          .from(whatsappSmokeRuns)
          .where(eq(whatsappSmokeRuns.clinicId, input.clinicId))
          .orderBy(desc(whatsappSmokeRuns.startedAt))
          .limit(1),
      ]);
      const run = latestRun[0];
      const now = new Date();
      const currentGeneration = current.metadata.provisioningEventId ?? null;
      if (
        circuit?.status !== "closed" ||
        run === undefined ||
        run.id !== match[1] ||
        run.status !== "pending" ||
        !run.requiresRealRoundtrip ||
        run.syntheticContact ||
        run.realPatientsEnabled ||
        run.testContactId === null ||
        run.timeoutAt === null ||
        run.timeoutAt <= now ||
        run.provisioningEventId === null ||
        run.provisioningEventId !== currentGeneration ||
        input.recipientPhoneE164 === null
      ) {
        return undefined;
      }
      const testContactId = run.testContactId;
      const reception = run.steps.find(
        (step) => step.code === "real-reception",
      );
      const processing = run.steps.find(
        (step) => step.code === "real-processing",
      );
      const response = run.steps.find((step) => step.code === "real-response");
      const delivery = run.steps.find((step) => step.code === "real-delivery");
      if (
        reception?.status !== "passed" ||
        !reception.passed ||
        processing?.status !== "passed" ||
        !processing.passed ||
        response?.status !== "pending" ||
        delivery?.status !== "pending"
      ) {
        return undefined;
      }
      const [contact, patientLink] = await Promise.all([
        transaction.query.contacts.findFirst({
          columns: { id: true, phoneE164: true },
          where: and(
            eq(contacts.clinicId, input.clinicId),
            eq(contacts.id, testContactId),
          ),
        }),
        transaction.query.contactPatientLinks.findFirst({
          columns: { id: true },
          where: and(
            eq(contactPatientLinks.clinicId, input.clinicId),
            eq(contactPatientLinks.contactId, testContactId),
          ),
        }),
      ]);
      if (
        contact?.phoneE164 == null ||
        contact.phoneE164 !== input.recipientPhoneE164 ||
        patientLink !== undefined
      ) {
        return undefined;
      }
      return current;
    },
  );
  if (connection === undefined || !isWhatsAppConnectionReady(connection)) {
    throw new WhatsAppConnectionRequiredError();
  }
  return connection;
}

async function requireWhatsAppConnection(
  input: { clinicId: string; provider: WhatsAppProviderId },
  requireRealTraffic: boolean,
) {
  const connection = await inWhatsAppProviderTransaction(
    input.clinicId,
    async (transaction) => {
      const connection = await transaction.query.whatsappConnections.findFirst({
        where: and(
          eq(whatsappConnections.clinicId, input.clinicId),
          eq(whatsappConnections.provider, input.provider),
        ),
      });
      if (connection === undefined) return undefined;
      if (input.provider === "kapso") {
        const [readiness, billing, templates, circuit, clinic, gates, smoke] =
          await Promise.all([
            transaction.query.whatsappReadiness.findFirst({
              where: eq(whatsappReadiness.clinicId, input.clinicId),
            }),
            transaction.query.whatsappBilling.findFirst({
              where: eq(whatsappBilling.clinicId, input.clinicId),
            }),
            transaction.query.whatsappCriticalTemplates.findMany({
              where: eq(whatsappCriticalTemplates.clinicId, input.clinicId),
            }),
            transaction.query.whatsappCircuitBreakers.findFirst({
              where: eq(whatsappCircuitBreakers.clinicId, input.clinicId),
            }),
            transaction.query.clinics.findFirst({
              columns: { isSynthetic: true },
              where: eq(clinics.id, input.clinicId),
            }),
            transaction.query.whatsappTrafficGateEvidences.findMany({
              where: eq(whatsappTrafficGateEvidences.clinicId, input.clinicId),
            }),
            transaction
              .select()
              .from(whatsappSmokeRuns)
              .where(eq(whatsappSmokeRuns.clinicId, input.clinicId))
              .orderBy(desc(whatsappSmokeRuns.startedAt))
              .limit(1),
          ]);
        if (circuit?.status === "open") {
          throw new WhatsAppCircuitBreakerOpenError(
            input.clinicId,
            circuit.reason,
          );
        }
        if (!requireRealTraffic && circuit?.status !== "closed") {
          throw new Error(
            "El circuit breaker de WhatsApp no está confirmado como cerrado",
          );
        }
        const billingStatus =
          readiness?.billingSyncStatus === "failed" ||
          billing?.status === "failed"
            ? "failed"
            : readiness?.billingSyncStatus === "ready" &&
                billing?.status === "ready"
              ? "ready"
              : "pending";
        if (readiness === undefined) return undefined;
        const readinessResult = evaluateWhatsAppReadiness({
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
            businessAccountId: connection.businessAccountId,
            connectionType: connection.connectionType,
            phoneNumberId: connection.phoneNumberId,
            provider: connection.provider,
            status: connection.status,
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
          templates: templates
            .filter(
              (template) =>
                template.projectId === readiness.projectId &&
                template.provisioningEventId === readiness.provisioningEventId,
            )
            .map((template) => ({
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
        } satisfies WhatsAppReadinessInput);
        if (
          readinessResult?.status !== "ready" ||
          readiness.projectWebhookId === null ||
          readiness.phoneNumberWebhookId === null ||
          connection.metadata.webhookStatus !== "ready" ||
          !isWhatsAppNumberMessagingAvailable(connection.metadata.health) ||
          connection.phoneNumberId == null ||
          connection.businessAccountId == null ||
          readiness.phoneNumberId !== connection.phoneNumberId ||
          readiness.businessAccountId !==
            (connection.businessAccountId ?? null) ||
          readiness.projectId !== (connection.metadata.projectId ?? null) ||
          readiness.provisioningEventId !==
            (connection.metadata.provisioningEventId ?? null)
        ) {
          return undefined;
        }
        if (requireRealTraffic) {
          const latestSmoke = smoke[0];
          const templateDeliveryVerified =
            latestSmoke?.steps.some(
              (step) =>
                step.code === "real-template-delivery" &&
                step.status === "passed" &&
                step.passed,
            ) ?? false;
          const trafficEvaluation = evaluateWhatsAppRealTraffic({
            circuitStatus: circuit?.status ?? "closed",
            clinicIsSynthetic: clinic?.isSynthetic ?? true,
            connectionGenerationId:
              connection.metadata.provisioningEventId ?? null,
            connectionProvider: connection.provider,
            connectionStatus: connection.status,
            gates: Object.fromEntries(
              gates.map((gate) => [
                gate.code,
                {
                  evidenceReference: gate.evidenceReference,
                  ready: gate.ready,
                },
              ]),
            ),
            requireEnabled: true,
            smoke: {
              ...(latestSmoke ?? {
                providerTransportVerified: false,
                realPatientsEnabled: false,
                status: "pending" as const,
                syntheticContact: false,
              }),
              templateDeliveryVerified,
            },
            technicalReadiness: readinessResult.status,
            trafficStatus: connection.realTrafficStatus,
          });
          if (!trafficEvaluation.allowed) {
            throw new WhatsAppRealTrafficBlockedError(
              trafficEvaluation.blockers,
            );
          }
        }
      }
      return connection;
    },
  );
  if (connection === undefined || !isWhatsAppConnectionReady(connection)) {
    throw new WhatsAppConnectionRequiredError();
  }
  return connection;
}
