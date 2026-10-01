import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { evaluateWhatsAppRealTraffic } from "~/domain/whatsapp-traffic";
import { recordWhatsAppSyntheticSmokeStep } from "~/domain/whatsapp-smoke";
import { sanitizeWhatsAppOperationalText } from "~/domain/whatsapp-circuit-breaker";
import { readWhatsAppConsentSnapshot } from "~/server/db/whatsapp-consent-query";
import { isWhatsAppSmokeContactEligibleInTransaction } from "~/server/db/whatsapp-smoke-contact";
import type { WhatsAppCriticalTemplateKind } from "~/domain/whatsapp-readiness";
import type {
  PreparedWhatsAppTemplateSmoke,
  WhatsAppTemplateSmokeStore,
} from "~/server/application/whatsapp-template-smoke";
import {
  inSuperadminTransaction,
  inWhatsAppOutboundWorkerTransaction,
  lockWhatsAppCircuit,
  setWhatsAppWorkerClinicContext,
  type ClinicTransaction,
} from "~/server/db/clinic-context";
import {
  persistSmokeResult,
  smokeResultFromRow,
} from "~/server/db/whatsapp-smoke-run-store";
import {
  apoloAuditEvents,
  apoloSuperadmins,
  clinics,
  contacts,
  whatsappCircuitBreakers,
  whatsappConnections,
  whatsappCriticalTemplates,
  whatsappReadiness,
  whatsappSmokeRuns,
} from "~/server/db/schema";

const TEMPLATE_DELIVERY_CODE = "real-template-delivery" as const;
const INBOUND_ROUNDTRIP_CODES = [
  "real-reception",
  "real-processing",
  "real-response",
  "real-delivery",
] as const;

export const drizzleWhatsAppTemplateSmokeStore: WhatsAppTemplateSmokeStore = {
  async start(input) {
    return inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        await lockWhatsAppCircuit(transaction, input.clinicId);
        await setClinicContext(transaction, input.clinicId);

        const [clinic, connection, readiness, circuit] = await Promise.all([
          transaction.query.clinics.findFirst({
            columns: { isSynthetic: true, name: true },
            where: eq(clinics.id, input.clinicId),
          }),
          transaction.query.whatsappConnections.findFirst({
            where: eq(whatsappConnections.clinicId, input.clinicId),
          }),
          transaction.query.whatsappReadiness.findFirst({
            where: eq(whatsappReadiness.clinicId, input.clinicId),
          }),
          transaction.query.whatsappCircuitBreakers.findFirst({
            where: eq(whatsappCircuitBreakers.clinicId, input.clinicId),
          }),
        ]);
        if (clinic === undefined || clinic.isSynthetic) {
          throw new Error("La prueba de plantilla requiere una Clínica real");
        }
        if (
          connection?.provider !== "kapso" ||
          connection.status !== "ready" ||
          connection.phoneNumberId === null ||
          connection.realTrafficStatus !== "blocked"
        ) {
          throw new Error("La Conexión Kapso no está lista para la prueba");
        }
        if (circuit?.status !== "closed") {
          throw new Error("El circuit breaker de WhatsApp está abierto");
        }
        const provisioningEventId =
          connection.metadata.provisioningEventId ?? null;
        const projectId = connection.metadata.projectId ?? null;
        if (
          readiness?.technicalStatus !== "ready" ||
          provisioningEventId === null ||
          projectId === null ||
          readiness.provisioningEventId !== provisioningEventId ||
          readiness.projectId !== projectId ||
          readiness.phoneNumberId !== connection.phoneNumberId
        ) {
          throw new Error(
            "La generación actual de Kapso no tiene readiness técnico vigente",
          );
        }

        const template =
          await transaction.query.whatsappCriticalTemplates.findFirst({
            where: and(
              eq(whatsappCriticalTemplates.clinicId, input.clinicId),
              eq(whatsappCriticalTemplates.kind, input.templateKind),
              eq(whatsappCriticalTemplates.projectId, projectId),
              eq(
                whatsappCriticalTemplates.provisioningEventId,
                provisioningEventId,
              ),
              eq(whatsappCriticalTemplates.category, "UTILITY"),
              eq(whatsappCriticalTemplates.status, "APPROVED"),
              eq(whatsappCriticalTemplates.provisioningStatus, "approved"),
            ),
          });
        if (
          template?.providerTemplateId == null ||
          template.providerTemplateId.trim() === ""
        ) {
          throw new Error(
            "No hay una plantilla Utility aprobada para esta prueba",
          );
        }

        const [latest] = await transaction
          .select()
          .from(whatsappSmokeRuns)
          .where(eq(whatsappSmokeRuns.clinicId, input.clinicId))
          .orderBy(desc(whatsappSmokeRuns.startedAt))
          .limit(1)
          .for("update");
        if (
          latest === undefined ||
          !latest.requiresRealRoundtrip ||
          latest.syntheticContact ||
          latest.realPatientsEnabled ||
          latest.testContactId === null ||
          latest.provisioningEventId !== provisioningEventId ||
          !hasCompletedInboundRoundtrip(latest.steps)
        ) {
          throw new Error(
            "Completa primero el roundtrip entrante de la generación actual",
          );
        }

        const contact = await readSmokeContact(
          transaction,
          input.clinicId,
          latest.testContactId,
        );
        const consent = await readWhatsAppConsentSnapshot(transaction, {
          clinicId: input.clinicId,
          contactId: latest.testContactId,
          now: input.now,
          patientId: null,
        });
        const acceptedAt = consent.acceptedAt;
        if (consent.decision !== "allowed" || acceptedAt === null) {
          throw new Error(
            "El Contacto de prueba necesita consentimiento vigente para recibir la plantilla",
          );
        }
        const capturedConsent = { ...consent, acceptedAt };

        const pendingStep = latest.steps.find(
          (step) => step.code === TEMPLATE_DELIVERY_CODE,
        );
        if (
          latest.status === "pending" &&
          pendingStep?.status === "pending" &&
          pendingStep.attemptId !== undefined &&
          pendingStep.templateKind === input.templateKind &&
          pendingStep.templateName === template.name &&
          pendingStep.providerTemplateId === template.providerTemplateId &&
          pendingStep.templateCatalogVersion === template.catalogVersion &&
          pendingStep.consentReference === consent.reference &&
          pendingStep.consentAcceptedAt === acceptedAt.toISOString() &&
          latest.timeoutAt !== null &&
          latest.timeoutAt > input.now
        ) {
          return preparedTemplateSmoke({
            clinicName: clinic.name,
            contactPhoneE164: contact.phoneE164,
            attemptId: pendingStep.attemptId,
            contactId: latest.testContactId,
            consent: capturedConsent,
            runId: latest.id,
            startedAt: latest.startedAt,
            template,
          });
        }

        const pendingRun = await transaction.query.whatsappSmokeRuns.findFirst({
          columns: { id: true },
          where: and(
            eq(whatsappSmokeRuns.clinicId, input.clinicId),
            eq(whatsappSmokeRuns.status, "pending"),
          ),
        });
        if (pendingRun !== undefined) {
          throw new Error("Ya hay una prueba real de WhatsApp pendiente");
        }
        const canRetryFailedTemplate =
          latest.status === "failed" &&
          latest.finishedAt !== null &&
          pendingStep?.status === "failed" &&
          latest.blockers.every(
            (blocker) =>
              blocker.code === TEMPLATE_DELIVERY_CODE ||
              blocker.code.startsWith(`${TEMPLATE_DELIVERY_CODE}-`),
          );
        if (
          (latest.status !== "passed" || latest.finishedAt === null) &&
          !canRetryFailedTemplate
        ) {
          throw new Error(
            "El roundtrip entrante debe completarse antes de probar la plantilla",
          );
        }

        const attemptId = randomUUID();
        const templateStep = {
          code: TEMPLATE_DELIVERY_CODE,
          evidence: `Plantilla Utility ${template.name}; esperando callback de Kapso`,
          eventId: null,
          message: null,
          observedAt: null,
          passed: false,
          source: "provider" as const,
          status: "pending" as const,
          attemptId,
          consentAcceptedAt: acceptedAt.toISOString(),
          consentPrivacyVersion: capturedConsent.privacyVersion,
          consentReference: capturedConsent.reference,
          consentTermsVersion: capturedConsent.termsVersion,
          consentTextReference: capturedConsent.textReference,
          providerMessageId: null,
          providerTemplateId: template.providerTemplateId,
          templateCatalogVersion: template.catalogVersion,
          templateKind: input.templateKind,
          templateLocale: template.locale,
          templateName: template.name,
        };
        const steps = [
          ...latest.steps.filter(
            (step) => step.code !== TEMPLATE_DELIVERY_CODE,
          ),
          templateStep,
        ];
        const [updated] = await transaction
          .update(whatsappSmokeRuns)
          .set({
            blockers: [],
            finishedAt: null,
            status: "pending",
            steps,
            timeoutAt: input.timeoutAt,
            timedOutAt: null,
          })
          .where(
            and(
              eq(whatsappSmokeRuns.clinicId, input.clinicId),
              eq(whatsappSmokeRuns.id, latest.id),
              eq(whatsappSmokeRuns.status, latest.status),
            ),
          )
          .returning({ id: whatsappSmokeRuns.id });
        if (updated === undefined) {
          throw new Error("El smoke cambió mientras iniciaba la prueba");
        }
        await transaction.insert(apoloAuditEvents).values({
          action: "whatsapp-template-smoke-started",
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          occurredAt: input.now,
          operationKey: `${latest.id}:template-smoke-started:${attemptId}`,
        });

        return preparedTemplateSmoke({
          clinicName: clinic.name,
          contactPhoneE164: contact.phoneE164,
          attemptId,
          contactId: latest.testContactId,
          consent: capturedConsent,
          runId: latest.id,
          startedAt: latest.startedAt,
          template,
        });
      },
    );
  },

  async accepted(input) {
    await inWhatsAppOutboundWorkerTransaction(async (transaction) => {
      if (
        !(await setWhatsAppWorkerClinicContext(transaction, input.clinicId))
      ) {
        return;
      }
      await lockWhatsAppCircuit(transaction, input.clinicId);
      const latest = await findCurrentTemplateSmokeRun(
        transaction,
        input.clinicId,
        input.runId,
        input.attemptId,
      );
      if (latest === undefined) return;
      const steps = latest.steps.map((step) =>
        step.code === TEMPLATE_DELIVERY_CODE &&
        step.attemptId === input.attemptId
          ? { ...step, providerMessageId: input.providerMessageId }
          : step,
      );
      await transaction
        .update(whatsappSmokeRuns)
        .set({ steps })
        .where(
          and(
            eq(whatsappSmokeRuns.clinicId, input.clinicId),
            eq(whatsappSmokeRuns.id, input.runId),
            eq(whatsappSmokeRuns.status, "pending"),
          ),
        );
    });
  },

  async fail(input) {
    await inWhatsAppOutboundWorkerTransaction(async (transaction) => {
      await setWhatsAppWorkerClinicContext(transaction, input.clinicId);
      await lockWhatsAppCircuit(transaction, input.clinicId);
      const latest = await findCurrentTemplateSmokeRun(
        transaction,
        input.clinicId,
        input.runId,
        input.attemptId,
      );
      if (latest === undefined) return;
      const templateKind = smokeTemplateKind(latest);
      const templateName = smokeTemplateName(latest);
      const result = recordWhatsAppSyntheticSmokeStep(
        smokeResultFromRow(latest),
        {
          code: TEMPLATE_DELIVERY_CODE,
          evidence: "Kapso rechazó la solicitud de la plantilla de prueba",
          message:
            sanitizeWhatsAppOperationalText(input.error) ||
            "Kapso rechazó el envío de la plantilla de prueba",
          observedAt: input.now,
          source: "provider",
          status: "failed",
          attemptId: input.attemptId,
          ...(templateKind === null ? {} : { templateKind }),
          ...(templateName === null ? {} : { templateName }),
        },
      );
      await persistSmokeResult(transaction, {
        clinicId: input.clinicId,
        finishedAt: input.now,
        result,
        runId: latest.id,
      });
    });
  },
};

export async function recordSmokeTemplateOutcome(
  transaction: ClinicTransaction,
  input: {
    idempotencyKey: string;
    now: Date;
    phoneNumberId: string | null;
    providerEventId?: string | null;
    providerMessageId?: string | null;
    status: "sent" | "delivered" | "read" | "failed";
    error?: string | null;
  },
) {
  const match =
    /^whatsapp-smoke:([0-9a-f-]{36}):template:([0-9a-f-]{36})$/i.exec(
      input.idempotencyKey,
    );
  if (match === null && input.providerMessageId == null) return false;
  if (input.status === "sent") return match !== null;
  if (input.phoneNumberId === null) return match !== null;
  const connection = await transaction.query.whatsappConnections.findFirst({
    where: and(
      eq(whatsappConnections.phoneNumberId, input.phoneNumberId),
      eq(whatsappConnections.provider, "kapso"),
    ),
  });
  if (connection === undefined) return match !== null;
  const clinicId = connection.clinicId;
  await setWhatsAppWorkerClinicContext(transaction, clinicId);
  await lockWhatsAppCircuit(transaction, clinicId);
  let runId: string;
  let attemptId: string;
  if (match !== null) {
    runId = match[1]!;
    attemptId = match[2]!;
  } else {
    const [latest] = await transaction
      .select()
      .from(whatsappSmokeRuns)
      .where(eq(whatsappSmokeRuns.clinicId, clinicId))
      .orderBy(desc(whatsappSmokeRuns.startedAt))
      .limit(1)
      .for("update");
    const pendingStep = latest?.steps.find(
      (candidate) =>
        candidate.code === TEMPLATE_DELIVERY_CODE &&
        candidate.providerMessageId === input.providerMessageId,
    );
    if (
      latest === undefined ||
      pendingStep?.attemptId === undefined ||
      pendingStep.status !== "pending"
    ) {
      return false;
    }
    runId = latest.id;
    attemptId = pendingStep.attemptId;
  }
  const latest = await findCurrentTemplateSmokeRun(
    transaction,
    clinicId,
    runId,
    attemptId,
  );
  if (
    latest?.testContactId == null ||
    latest.timeoutAt === null ||
    latest.timeoutAt <= input.now ||
    latest.provisioningEventId === null ||
    connection.metadata.provisioningEventId !== latest.provisioningEventId
  ) {
    return true;
  }
  const step = latest.steps.find(
    (candidate) => candidate.code === TEMPLATE_DELIVERY_CODE,
  );
  if (step?.status !== "pending") return true;
  const templateKind = smokeTemplateKind(latest);
  const templateName = smokeTemplateName(latest);
  if (
    templateKind === null ||
    templateName === null ||
    step.providerTemplateId === undefined ||
    step.templateCatalogVersion === undefined ||
    step.templateLocale === undefined
  ) {
    return true;
  }

  const template = await transaction.query.whatsappCriticalTemplates.findFirst({
    where: and(
      eq(whatsappCriticalTemplates.clinicId, clinicId),
      eq(whatsappCriticalTemplates.kind, templateKind),
      eq(whatsappCriticalTemplates.name, templateName),
      eq(whatsappCriticalTemplates.providerTemplateId, step.providerTemplateId),
      eq(whatsappCriticalTemplates.catalogVersion, step.templateCatalogVersion),
      eq(whatsappCriticalTemplates.locale, step.templateLocale),
      eq(whatsappCriticalTemplates.category, "UTILITY"),
      eq(whatsappCriticalTemplates.status, "APPROVED"),
      eq(whatsappCriticalTemplates.provisioningStatus, "approved"),
      eq(
        whatsappCriticalTemplates.provisioningEventId,
        latest.provisioningEventId,
      ),
    ),
  });
  const consent = await readWhatsAppConsentSnapshot(transaction, {
    clinicId,
    contactId: latest.testContactId,
    now: input.now,
    patientId: null,
  });
  let contactStillControlled = true;
  try {
    await readSmokeContact(transaction, clinicId, latest.testContactId);
  } catch {
    contactStillControlled = false;
  }
  const consentStillMatches = isCapturedConsentCurrent(step, consent);
  const callbackStatus =
    input.status === "failed" ||
    template === undefined ||
    !consentStillMatches ||
    !contactStillControlled
      ? "failed"
      : "passed";
  const failureMessage =
    input.status === "failed"
      ? sanitizeWhatsAppOperationalText(
          input.error ?? "Kapso reportó fallo de entrega",
        ) || "Kapso reportó fallo de entrega"
      : template === undefined
        ? "La plantilla cambió o dejó de estar aprobada antes de confirmar la entrega"
        : !consentStillMatches
          ? "El consentimiento del Contacto de prueba dejó de estar vigente; no se habilitó el tráfico real"
          : !contactStillControlled
            ? "El Contacto de prueba ya no cumple las condiciones de control"
            : null;

  const result = recordWhatsAppSyntheticSmokeStep(smokeResultFromRow(latest), {
    code: TEMPLATE_DELIVERY_CODE,
    eventId: input.providerEventId ?? input.providerMessageId,
    evidence:
      input.status === "failed"
        ? `Kapso confirmó fallo de entrega de la plantilla ${templateName}`
        : `Kapso confirmó ${input.status === "read" ? "lectura" : "entrega"} de la plantilla ${templateName}`,
    message: failureMessage,
    observedAt: input.now,
    source: "provider",
    status: callbackStatus,
    attemptId,
    consentAcceptedAt: step.consentAcceptedAt,
    consentPrivacyVersion: step.consentPrivacyVersion,
    consentReference: step.consentReference,
    consentTermsVersion: step.consentTermsVersion,
    consentTextReference: step.consentTextReference,
    providerMessageId: input.providerMessageId,
    providerTemplateId: step.providerTemplateId,
    templateCatalogVersion: step.templateCatalogVersion,
    templateKind,
    templateLocale: step.templateLocale,
    templateName,
  });
  await persistSmokeResult(transaction, {
    clinicId,
    finishedAt: input.now,
    result,
    runId: latest.id,
  });

  if (
    callbackStatus === "failed" ||
    result.status !== "passed" ||
    result.steps.find((candidate) => candidate.code === TEMPLATE_DELIVERY_CODE)
      ?.passed !== true
  ) {
    return true;
  }
  await enableRealTrafficAfterTemplateDelivery(transaction, {
    clinicId,
    now: input.now,
    run: latest,
    result,
    templateKind,
    templateName,
    providerTemplateId: step.providerTemplateId,
    templateCatalogVersion: step.templateCatalogVersion,
    phoneNumberId: input.phoneNumberId,
  });
  return true;
}

async function enableRealTrafficAfterTemplateDelivery(
  transaction: ClinicTransaction,
  input: {
    clinicId: string;
    now: Date;
    run: typeof whatsappSmokeRuns.$inferSelect;
    result: ReturnType<typeof smokeResultFromRow>;
    templateKind: WhatsAppCriticalTemplateKind;
    templateName: string;
    providerTemplateId: string;
    templateCatalogVersion: number;
    phoneNumberId: string | null;
  },
) {
  if (input.run.provisioningEventId === null || input.phoneNumberId === null) {
    return;
  }
  const [clinic, connection, readiness, circuit, template, superadmin] =
    await Promise.all([
      transaction.query.clinics.findFirst({
        columns: { isSynthetic: true },
        where: eq(clinics.id, input.clinicId),
      }),
      transaction.query.whatsappConnections.findFirst({
        where: eq(whatsappConnections.clinicId, input.clinicId),
      }),
      transaction.query.whatsappReadiness.findFirst({
        where: eq(whatsappReadiness.clinicId, input.clinicId),
      }),
      transaction.query.whatsappCircuitBreakers.findFirst({
        columns: { status: true },
        where: eq(whatsappCircuitBreakers.clinicId, input.clinicId),
      }),
      transaction.query.whatsappCriticalTemplates.findFirst({
        where: and(
          eq(whatsappCriticalTemplates.clinicId, input.clinicId),
          eq(whatsappCriticalTemplates.kind, input.templateKind),
          eq(whatsappCriticalTemplates.name, input.templateName),
          eq(
            whatsappCriticalTemplates.providerTemplateId,
            input.providerTemplateId,
          ),
          eq(
            whatsappCriticalTemplates.catalogVersion,
            input.templateCatalogVersion,
          ),
          eq(whatsappCriticalTemplates.status, "APPROVED"),
          eq(whatsappCriticalTemplates.category, "UTILITY"),
          eq(whatsappCriticalTemplates.provisioningStatus, "approved"),
          eq(
            whatsappCriticalTemplates.provisioningEventId,
            input.run.provisioningEventId,
          ),
        ),
      }),
      transaction.query.apoloSuperadmins.findFirst({
        columns: { identityId: true },
        where: eq(apoloSuperadmins.identityId, input.run.actorIdentityId),
      }),
    ]);
  const currentGeneration = connection?.metadata.provisioningEventId ?? null;
  const templateDeliveryVerified =
    input.result.steps.find((step) => step.code === TEMPLATE_DELIVERY_CODE)
      ?.status === "passed" &&
    input.result.steps.find((step) => step.code === TEMPLATE_DELIVERY_CODE)
      ?.passed === true;
  const evaluation = evaluateWhatsAppRealTraffic({
    circuitStatus: circuit?.status ?? "open",
    clinicIsSynthetic: clinic?.isSynthetic ?? true,
    connectionGenerationId: currentGeneration,
    connectionProvider: connection?.provider,
    connectionStatus: connection?.status ?? null,
    gates: {},
    requireEnabled: false,
    smoke: {
      controlledTestContact: input.result.controlledTestContact,
      providerTransportVerified: input.result.providerTransportVerified,
      provisioningEventId: input.run.provisioningEventId,
      realPatientsEnabled: input.result.realPatientsEnabled,
      status: input.result.status,
      syntheticContact: input.result.syntheticContact,
      templateDeliveryVerified,
    },
    technicalReadiness: readiness?.technicalStatus ?? "blocked",
    trafficStatus: connection?.realTrafficStatus ?? "offboarded",
  });
  if (
    !evaluation.allowed ||
    clinic?.isSynthetic !== false ||
    connection?.provider !== "kapso" ||
    connection.status !== "ready" ||
    connection.phoneNumberId !== input.phoneNumberId ||
    connection.realTrafficStatus !== "blocked" ||
    currentGeneration === null ||
    input.run.provisioningEventId !== currentGeneration ||
    readiness?.technicalStatus !== "ready" ||
    readiness.provisioningEventId !== currentGeneration ||
    readiness.phoneNumberId !== connection.phoneNumberId ||
    template === undefined ||
    superadmin === undefined ||
    circuit?.status !== "closed" ||
    input.run.testContactId === null ||
    input.run.timeoutAt === null ||
    input.run.timeoutAt <= input.now ||
    !hasCompletedInboundRoundtrip(input.run.steps)
  ) {
    return;
  }
  try {
    await readSmokeContact(
      transaction,
      input.clinicId,
      input.run.testContactId,
    );
  } catch {
    return;
  }
  const deliveryStep = input.result.steps.find(
    (step) => step.code === TEMPLATE_DELIVERY_CODE,
  );
  const consent = await readWhatsAppConsentSnapshot(transaction, {
    clinicId: input.clinicId,
    contactId: input.run.testContactId,
    now: input.now,
    patientId: null,
  });
  if (
    deliveryStep === undefined ||
    !isCapturedConsentCurrent(deliveryStep, consent)
  ) {
    return;
  }
  if (!(await setWhatsAppWorkerClinicContext(transaction, input.clinicId))) {
    return;
  }

  await transaction.execute(
    sql`select set_config('app.whatsapp_template_delivery_worker', 'true', true)`,
  );
  const [updated] = await transaction
    .update(whatsappConnections)
    .set({
      realTrafficEnabledAt: input.now,
      realTrafficEnabledByIdentityId: input.run.actorIdentityId,
      realTrafficStatus: "enabled",
      updatedAt: input.now,
    })
    .where(
      and(
        eq(whatsappConnections.clinicId, input.clinicId),
        eq(whatsappConnections.provider, "kapso"),
        eq(whatsappConnections.status, "ready"),
        eq(whatsappConnections.phoneNumberId, input.phoneNumberId),
        eq(whatsappConnections.realTrafficStatus, "blocked"),
        sql`${whatsappConnections.metadata}->>'provisioningEventId' = ${currentGeneration}`,
      ),
    )
    .returning({ clinicId: whatsappConnections.clinicId });
  if (updated === undefined) return;

  await transaction
    .insert(apoloAuditEvents)
    .values({
      action: "whatsapp-real-traffic-enabled",
      actorIdentityId: input.run.actorIdentityId,
      clinicId: input.clinicId,
      occurredAt: input.now,
      operationKey: `${input.run.id}:template-delivery-enabled`,
    })
    .onConflictDoNothing({ target: apoloAuditEvents.operationKey });
}

async function findCurrentTemplateSmokeRun(
  transaction: ClinicTransaction,
  clinicId: string,
  runId: string,
  attemptId?: string,
) {
  const [latest] = await transaction
    .select()
    .from(whatsappSmokeRuns)
    .where(eq(whatsappSmokeRuns.clinicId, clinicId))
    .orderBy(desc(whatsappSmokeRuns.startedAt))
    .limit(1)
    .for("update");
  if (
    latest?.id !== runId ||
    latest.status !== "pending" ||
    !latest.requiresRealRoundtrip ||
    latest.syntheticContact ||
    latest.realPatientsEnabled ||
    latest.testContactId === null
  ) {
    return undefined;
  }
  const step = latest.steps.find(
    (candidate) => candidate.code === TEMPLATE_DELIVERY_CODE,
  );
  return step?.status === "pending" &&
    (attemptId === undefined || step.attemptId === attemptId)
    ? latest
    : undefined;
}

async function readSmokeContact(
  transaction: ClinicTransaction,
  clinicId: string,
  contactId: string,
) {
  const contact = await transaction.query.contacts.findFirst({
    columns: { id: true, phoneE164: true },
    where: and(eq(contacts.clinicId, clinicId), eq(contacts.id, contactId)),
  });
  if (contact?.phoneE164 == null) {
    throw new Error("El Contacto de prueba ya no tiene un teléfono válido");
  }
  const eligible = await isWhatsAppSmokeContactEligibleInTransaction(
    transaction,
    { clinicId, contactId },
  );
  if (!eligible) {
    throw new Error("El Contacto de prueba está vinculado a un Paciente real");
  }
  return { phoneE164: contact.phoneE164 };
}

function hasCompletedInboundRoundtrip(
  steps: typeof whatsappSmokeRuns.$inferSelect.steps,
) {
  return INBOUND_ROUNDTRIP_CODES.every((code) => {
    const step = steps.find((candidate) => candidate.code === code);
    return (
      step?.status === "passed" &&
      step.passed &&
      step.source ===
        (code === "real-processing" ? "application" : "provider") &&
      step.eventId !== null &&
      step.observedAt !== null
    );
  });
}

function preparedTemplateSmoke(input: {
  attemptId: string;
  clinicName: string;
  contactPhoneE164: string;
  contactId: string;
  consent: {
    acceptedAt: Date;
    privacyVersion: string;
    reference: string;
    termsVersion: string;
    textReference: string;
  };
  runId: string;
  startedAt: Date;
  template: typeof whatsappCriticalTemplates.$inferSelect;
}): PreparedWhatsAppTemplateSmoke {
  return {
    attemptId: input.attemptId,
    clinicName: input.clinicName,
    phoneE164: input.contactPhoneE164,
    contactId: input.contactId,
    runId: input.runId,
    startedAt: input.startedAt,
    consent: input.consent,
    template: {
      catalogVersion: input.template.catalogVersion,
      category: input.template.category,
      kind: input.template.kind,
      locale: input.template.locale,
      name: input.template.name,
      providerTemplateId: input.template.providerTemplateId,
      status: input.template.status,
      variables: input.template.variables,
    },
  };
}

function isCapturedConsentCurrent(
  step: (typeof whatsappSmokeRuns.$inferSelect.steps)[number],
  consent: Awaited<ReturnType<typeof readWhatsAppConsentSnapshot>>,
) {
  return (
    consent.decision === "allowed" &&
    consent.acceptedAt !== null &&
    step.consentReference === consent.reference &&
    step.consentAcceptedAt === consent.acceptedAt.toISOString() &&
    step.consentTermsVersion === consent.termsVersion &&
    step.consentPrivacyVersion === consent.privacyVersion &&
    step.consentTextReference === consent.textReference
  );
}

function smokeTemplateKind(
  run: typeof whatsappSmokeRuns.$inferSelect,
): WhatsAppCriticalTemplateKind | null {
  const step = run.steps.find(
    (candidate) => candidate.code === TEMPLATE_DELIVERY_CODE,
  );
  return step?.templateKind ?? null;
}

function smokeTemplateName(run: typeof whatsappSmokeRuns.$inferSelect) {
  const step = run.steps.find(
    (candidate) => candidate.code === TEMPLATE_DELIVERY_CODE,
  );
  return step?.templateName ?? null;
}

async function setClinicContext(
  transaction: ClinicTransaction,
  clinicId: string,
) {
  await transaction.execute(
    sql`select set_config('app.clinic_id', ${clinicId}, true)`,
  );
}
