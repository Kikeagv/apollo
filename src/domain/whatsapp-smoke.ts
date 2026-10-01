import { sanitizeWhatsAppOperationalText } from "./whatsapp-circuit-breaker";
import type { WhatsAppCriticalTemplateKind } from "./whatsapp-readiness";

/** Códigos de evidencia de transporte y diagnósticos sintéticos de WhatsApp. */
export const whatsappSyntheticSmokeStepCodes = [
  "connection",
  "reception",
  "response",
  "takeover",
  "history-sync",
  "template",
  "delivery-status",
  "duplicate",
  "rate-limit",
  "timeout",
  "phone-number-created",
  "redirect",
  "batched-webhook",
  "invalid-signature",
  "webhook-retry",
  "webhook-paused",
  "template-status",
  "billing",
  "sandbox",
  "consent-pending",
  "consent-continue",
  "consent-fallback",
  "consent-idempotent",
  "consent-rejection",
  "consent-version",
  "patient-consent-inbound",
  "adult-flow",
  "guardian-pending",
  "guardian-verified",
  "patient-selection",
  "urgency",
  "legal-block",
  "webhook-preflight",
  "real-reception",
  "real-processing",
  "real-response",
  "real-delivery",
  "real-template-delivery",
] as const;

/** Pasos que solo se consideran verificados por un roundtrip de Kapso. */
export const whatsappSyntheticSmokeRoundtripStepCodes = [
  "real-reception",
  "real-processing",
  "real-response",
  "real-delivery",
] as const;

/** Comprobaciones que un adaptador externo puede corroborar adicionalmente. */
export const whatsappSyntheticSmokeProviderStepCodes = [
  "webhook-preflight",
  "phone-number-created",
  "redirect",
  "batched-webhook",
  "invalid-signature",
  "webhook-retry",
  "webhook-paused",
  "template-status",
  "billing",
  "sandbox",
] as const;

export type WhatsAppSyntheticSmokeStepCode =
  (typeof whatsappSyntheticSmokeStepCodes)[number];

export const whatsappSyntheticSmokeStepLabels: Record<
  WhatsAppSyntheticSmokeStepCode,
  string
> = {
  "adult-flow": "Flujo de adulto",
  billing: "Billing adjunto",
  "batched-webhook": "Webhook batched",
  connection: "Conexión",
  "consent-continue": "Consentimiento con CONTINUAR",
  "consent-fallback": "Fallback textual de consentimiento",
  "consent-idempotent": "Aceptación idempotente",
  "consent-pending": "Primer contacto sin aceptación",
  "consent-rejection": "Rechazo de comandos pendientes",
  "consent-version": "Aceptación vigente tras cambio de términos",
  "patient-consent-inbound": "Permiso del Contacto en inbound",
  "delivery-status": "Estado de delivery",
  duplicate: "Duplicado idempotente",
  "guardian-pending": "Tutor pendiente",
  "guardian-verified": "Tutor verificado y permiso del Contacto",
  "history-sync": "History sync ignorado de forma segura",
  "invalid-signature": "Firma inválida",
  "legal-block": "Plantilla aprobada requerida",
  "phone-number-created": "Phone number created",
  "patient-selection": "Selección explícita ante ausencia o ambigüedad",
  "rate-limit": "429 y Retry-After",
  reception: "Recepción",
  "real-delivery": "Delivery confirmado del asistente de la clínica",
  "real-template-delivery": "Delivery de la plantilla de prueba",
  "real-processing": "Procesamiento del mensaje entrante",
  "real-reception": "Recepción del mensaje del Contacto",
  "real-response": "Respuesta administrativa aceptada",
  redirect: "Redirect permitido",
  response: "Respuesta",
  sandbox: "Número sandbox bloqueado",
  template: "Template transaccional",
  "template-status": "Template PENDING/REJECTED/DISABLED bloqueado",
  timeout: "Timeout y reintento",
  takeover: "Takeover humano",
  urgency: "Ruta de urgencia sin consentimiento de agenda",
  "webhook-paused": "Webhook pausado",
  "webhook-preflight": "Preflight del webhook de proyecto",
  "webhook-retry": "Reintento de webhook",
};

export type WhatsAppSyntheticSmokeStep = {
  code: WhatsAppSyntheticSmokeStepCode;
  evidence: string | null;
  eventId: string | null;
  message: string | null;
  observedAt: Date | null;
  passed: boolean;
  source: "application" | "provider" | null;
  status: "failed" | "passed" | "pending" | "skipped";
  attemptId?: string;
  consentAcceptedAt?: string;
  consentPrivacyVersion?: string;
  consentReference?: string;
  consentTermsVersion?: string;
  consentTextReference?: string;
  providerMessageId?: string | null;
  providerTemplateId?: string;
  templateCatalogVersion?: number;
  templateKind?: WhatsAppCriticalTemplateKind;
  templateLocale?: string;
  templateName?: string;
};

export type WhatsAppSyntheticSmokeResult = {
  blockers: Array<{ code: string; message: string }>;
  evidence: string | null;
  providerTransportVerified?: boolean;
  controlledTestContact?: boolean;
  realPatientsEnabled: boolean;
  status: "failed" | "passed" | "pending";
  steps: WhatsAppSyntheticSmokeStep[];
  syntheticContact: boolean;
  requireRealRoundtrip?: boolean;
  runId?: string | null;
  testContactId?: string | null;
  testContactMaskedPhone?: string | null;
  timeoutAt?: Date | null;
  timedOutAt?: Date | null;
};

export type WhatsAppSyntheticSmokeStepInput = {
  evidence?: string | null;
  eventId?: string | null;
  message?: string | null;
  observedAt?: Date | null;
  passed: boolean;
  source?: "application" | "provider";
  status?: "failed" | "passed" | "pending" | "skipped";
};

const whatsappSmokeRunIdPattern =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function hasWhatsAppSmokeChallengePrefix(text: string | null) {
  return text !== null && /^PRUEBA WHATSAPP(?:\s|$)/i.test(text.trim());
}

export function parseWhatsAppSmokeChallenge(text: string | null) {
  if (text === null) return null;
  const match = new RegExp(
    `^PRUEBA WHATSAPP (${whatsappSmokeRunIdPattern})$`,
    "i",
  ).exec(text.trim());
  return match?.[1] ?? null;
}

export function parseWhatsAppSmokeReplyIdempotencyKey(key: string) {
  const match = new RegExp(
    `^whatsapp-smoke:(${whatsappSmokeRunIdPattern}):reply$`,
    "i",
  ).exec(key);
  return match?.[1] ?? null;
}

type WhatsAppSmokeRunGuardSnapshot = {
  id: string;
  provisioningEventId: string | null;
  realPatientsEnabled: boolean;
  requiresRealRoundtrip: boolean;
  status: "failed" | "passed" | "pending";
  steps: ReadonlyArray<
    Pick<WhatsAppSyntheticSmokeStep, "code" | "passed" | "status">
  >;
  syntheticContact: boolean;
  testContactId: string | null;
  timeoutAt: Date | null;
};

export function isWhatsAppSmokeRunAwaitingInbound(input: {
  now: Date;
  provisioningEventId: string | null;
  run: WhatsAppSmokeRunGuardSnapshot | undefined;
  runId: string | null;
}) {
  const run = input.run;
  const reception = run?.steps.find((step) => step.code === "real-reception");
  const processing = run?.steps.find((step) => step.code === "real-processing");
  const response = run?.steps.find((step) => step.code === "real-response");
  const delivery = run?.steps.find((step) => step.code === "real-delivery");
  return (
    input.runId !== null &&
    run?.id === input.runId &&
    run.status === "pending" &&
    run.requiresRealRoundtrip &&
    !run.syntheticContact &&
    !run.realPatientsEnabled &&
    run.testContactId !== null &&
    run.timeoutAt !== null &&
    run.timeoutAt > input.now &&
    run.provisioningEventId !== null &&
    run.provisioningEventId === input.provisioningEventId &&
    reception?.status === "pending" &&
    !reception.passed &&
    processing?.status === "pending" &&
    !processing.passed &&
    response?.status === "pending" &&
    !response.passed &&
    delivery?.status === "pending" &&
    !delivery.passed
  );
}

export function isWhatsAppSmokeRunAwaitingReply(input: {
  now: Date;
  provisioningEventId: string | null;
  run: WhatsAppSmokeRunGuardSnapshot | undefined;
  runId: string | null;
}) {
  const run = input.run;
  const reception = run?.steps.find((step) => step.code === "real-reception");
  const processing = run?.steps.find((step) => step.code === "real-processing");
  const response = run?.steps.find((step) => step.code === "real-response");
  const delivery = run?.steps.find((step) => step.code === "real-delivery");
  return (
    input.runId !== null &&
    run?.id === input.runId &&
    run.status === "pending" &&
    run.requiresRealRoundtrip &&
    !run.syntheticContact &&
    !run.realPatientsEnabled &&
    run.testContactId !== null &&
    run.timeoutAt !== null &&
    run.timeoutAt > input.now &&
    run.provisioningEventId !== null &&
    run.provisioningEventId === input.provisioningEventId &&
    reception?.status === "passed" &&
    reception.passed &&
    processing?.status === "passed" &&
    processing.passed &&
    response?.status === "pending" &&
    !response.passed &&
    delivery?.status === "pending" &&
    !delivery.passed
  );
}

/**
 * Normaliza el contrato del runner y falla cerrado ante pasos requeridos
 * ausentes, Contactos no controlados o intentos de habilitar Pacientes reales.
 */
export function evaluateWhatsAppSyntheticSmoke(input: {
  evidence?: string | null;
  providerTransportVerified?: boolean;
  realPatientsEnabled: boolean;
  requireRealRoundtrip?: boolean;
  runId?: string | null;
  steps: Partial<
    Record<WhatsAppSyntheticSmokeStepCode, WhatsAppSyntheticSmokeStepInput>
  >;
  syntheticContact: boolean;
  testContactId?: string | null;
  testContactMaskedPhone?: string | null;
  timeoutAt?: Date | null;
}): WhatsAppSyntheticSmokeResult {
  const blockers: Array<{ code: string; message: string }> = [];
  const steps = whatsappSyntheticSmokeStepCodes.map((code) => {
    const step = input.steps[code];
    if (code === "real-template-delivery") {
      return {
        code,
        evidence: null,
        eventId: null,
        message: "Paso exclusivo de la prueba real de plantilla",
        observedAt: null,
        passed: false,
        source: null,
        status: "skipped",
      } satisfies WhatsAppSyntheticSmokeStep;
    }
    if (step === undefined) {
      if (input.requireRealRoundtrip === true && !isRoundtripStep(code)) {
        return {
          code,
          evidence: null,
          eventId: null,
          message: "Escenario no ejecutado en el smoke operativo",
          observedAt: null,
          passed: false,
          source: null,
          status: "skipped",
        } satisfies WhatsAppSyntheticSmokeStep;
      }
      if (code === "webhook-preflight" && input.requireRealRoundtrip !== true) {
        return {
          code,
          evidence: null,
          eventId: null,
          message: null,
          observedAt: null,
          passed: false,
          source: null,
          status: "skipped",
        } satisfies WhatsAppSyntheticSmokeStep;
      }
      if (isRoundtripStep(code)) {
        const isRequired = input.requireRealRoundtrip === true;
        return {
          code,
          evidence: null,
          eventId: null,
          message: isRequired ? "A la espera del mensaje de prueba" : null,
          observedAt: null,
          passed: false,
          source: null,
          status: isRequired ? "pending" : "skipped",
        } satisfies WhatsAppSyntheticSmokeStep;
      }
      blockers.push({
        code,
        message: `El smoke no evidenció el paso ${whatsappSyntheticSmokeStepLabels[code]}`,
      });
      return {
        code,
        evidence: null,
        eventId: null,
        message: "Paso no ejecutado",
        observedAt: null,
        passed: false,
        source: null,
        status: "failed",
      } satisfies WhatsAppSyntheticSmokeStep;
    }

    const status = step.status ?? (step.passed ? "passed" : "failed");
    if (status === "skipped") {
      return {
        code,
        evidence: normalizeOperationalText(step.evidence),
        eventId: sanitizeOperationalText(step.eventId),
        message:
          sanitizeOperationalText(step.message) ??
          "Paso no aplicable a este runner",
        observedAt: step.observedAt ?? null,
        passed: false,
        source: step.source ?? null,
        status: "skipped",
      } satisfies WhatsAppSyntheticSmokeStep;
    }
    if (
      status === "failed" &&
      (input.requireRealRoundtrip !== true || isBlockingRealSmokeStep(code))
    ) {
      blockers.push({
        code,
        message:
          step.message ??
          `Falló el paso ${whatsappSyntheticSmokeStepLabels[code]}`,
      });
    }
    const evidence = normalizeOperationalText(step.evidence);
    const eventId = normalizeOperationalText(step.eventId);
    const observedAt = step.observedAt ?? null;
    const hasRoundtripReference =
      !requiresProviderEventReference(code) ||
      input.requireRealRoundtrip !== true ||
      (eventId !== null && observedAt !== null);
    const passed =
      status === "passed" && evidence !== null && hasRoundtripReference;
    if (
      status === "passed" &&
      (evidence === null || !hasRoundtripReference) &&
      (input.requireRealRoundtrip !== true || isBlockingRealSmokeStep(code))
    ) {
      blockers.push({
        code: `${code}-evidence`,
        message: `El paso ${whatsappSyntheticSmokeStepLabels[code]} no tiene referencias suficientes`,
      });
    }
    return {
      code,
      evidence,
      eventId: sanitizeOperationalText(eventId),
      message: sanitizeOperationalText(step.message),
      observedAt,
      passed,
      source: step.source ?? null,
      status: passed ? "passed" : status === "pending" ? "pending" : "failed",
    } satisfies WhatsAppSyntheticSmokeStep;
  });

  const controlledTestContact =
    input.requireRealRoundtrip === true &&
    (input.testContactId?.trim() ?? "") !== "";
  if (!input.syntheticContact && !controlledTestContact) {
    blockers.push({
      code: "synthetic-contact",
      message:
        "El smoke requiere un contacto sintético o un Contacto de prueba controlado",
    });
  }
  if (input.realPatientsEnabled) {
    blockers.push({
      code: "real-patients",
      message: "El smoke no puede habilitar Pacientes reales",
    });
  }

  const evidence = input.evidence?.trim();
  const requiresRoundtrip = input.requireRealRoundtrip === true;
  const hasFailedStep = hasBlockingFailedStep(steps, requiresRoundtrip);
  const hasPendingStep = hasRequiredPendingStep(steps, requiresRoundtrip);
  const providerTransportVerified = requiresRoundtrip
    ? hasVerifiedProviderRoundtrip(steps)
    : input.providerTransportVerified === true;
  const status =
    blockers.length > 0 || hasFailedStep
      ? "failed"
      : requiresRoundtrip && hasPendingStep
        ? "pending"
        : "passed";
  return sanitizeWhatsAppSyntheticSmokeResult({
    blockers,
    controlledTestContact,
    evidence: evidence === undefined || evidence === "" ? null : evidence,
    providerTransportVerified,
    realPatientsEnabled: input.realPatientsEnabled,
    status,
    steps,
    syntheticContact: input.syntheticContact,
    requireRealRoundtrip: requiresRoundtrip,
    runId: input.runId ?? null,
    testContactId: input.testContactId ?? null,
    testContactMaskedPhone: input.testContactMaskedPhone ?? null,
    timeoutAt: input.timeoutAt ?? null,
    timedOutAt: null,
  });
}

/** Agrega una observación de una costura real sin borrar el resto del run. */
export function recordWhatsAppSyntheticSmokeStep(
  result: WhatsAppSyntheticSmokeResult,
  input: {
    code: WhatsAppSyntheticSmokeStepCode;
    eventId?: string | null;
    evidence: string;
    observedAt: Date;
    source: "application" | "provider";
    status: "failed" | "passed";
    attemptId?: string;
    consentAcceptedAt?: string;
    consentPrivacyVersion?: string;
    consentReference?: string;
    consentTermsVersion?: string;
    consentTextReference?: string;
    message?: string | null;
    providerMessageId?: string | null;
    providerTemplateId?: string;
    templateCatalogVersion?: number;
    templateKind?: WhatsAppCriticalTemplateKind;
    templateLocale?: string;
    templateName?: string;
  },
): WhatsAppSyntheticSmokeResult {
  const evidence = sanitizeOperationalText(input.evidence);
  const eventId = sanitizeOperationalText(input.eventId);
  const passed =
    input.status === "passed" &&
    evidence !== null &&
    (!requiresProviderEventReference(input.code) ||
      (eventId !== null && input.observedAt instanceof Date));
  const status: WhatsAppSyntheticSmokeStep["status"] = passed
    ? "passed"
    : "failed";
  const steps = result.steps.map((step) =>
    step.code === input.code
      ? {
          ...step,
          code: input.code,
          evidence,
          eventId,
          message: sanitizeOperationalText(input.message),
          observedAt: input.observedAt,
          passed,
          source: input.source,
          status,
          ...(input.attemptId === undefined
            ? {}
            : { attemptId: input.attemptId }),
          ...(input.consentAcceptedAt === undefined
            ? {}
            : { consentAcceptedAt: input.consentAcceptedAt }),
          ...(input.consentPrivacyVersion === undefined
            ? {}
            : { consentPrivacyVersion: input.consentPrivacyVersion }),
          ...(input.consentReference === undefined
            ? {}
            : { consentReference: input.consentReference }),
          ...(input.consentTermsVersion === undefined
            ? {}
            : { consentTermsVersion: input.consentTermsVersion }),
          ...(input.consentTextReference === undefined
            ? {}
            : { consentTextReference: input.consentTextReference }),
          ...(input.providerMessageId === undefined ||
          input.providerMessageId === null
            ? {}
            : {
                providerMessageId:
                  sanitizeOperationalText(input.providerMessageId) ?? "",
              }),
          ...(input.providerTemplateId === undefined
            ? {}
            : { providerTemplateId: input.providerTemplateId }),
          ...(input.templateCatalogVersion === undefined
            ? {}
            : { templateCatalogVersion: input.templateCatalogVersion }),
          ...(input.templateKind === undefined
            ? {}
            : { templateKind: input.templateKind }),
          ...(input.templateLocale === undefined
            ? {}
            : { templateLocale: input.templateLocale }),
          ...(input.templateName === undefined
            ? {}
            : { templateName: input.templateName }),
        }
      : step,
  );
  const blockers = result.blockers.filter(
    (blocker) =>
      blocker.code !== input.code && !blocker.code.startsWith(`${input.code}-`),
  );
  if (!passed) {
    if (
      result.requireRealRoundtrip !== true ||
      isBlockingRealSmokeStep(input.code)
    ) {
      blockers.push({
        code: input.code,
        message:
          sanitizeOperationalText(input.message) ??
          `Falló el paso ${whatsappSyntheticSmokeStepLabels[input.code]}`,
      });
    }
  }
  const providerTransportVerified =
    result.requireRealRoundtrip === true && hasVerifiedProviderRoundtrip(steps);
  return sanitizeWhatsAppSyntheticSmokeResult({
    ...result,
    blockers,
    providerTransportVerified,
    steps,
    status:
      blockers.length > 0 ||
      hasBlockingFailedStep(steps, result.requireRealRoundtrip === true)
        ? "failed"
        : hasRequiredPendingStep(steps, result.requireRealRoundtrip === true)
          ? "pending"
          : "passed",
  });
}

export function expireWhatsAppSyntheticSmoke(
  result: WhatsAppSyntheticSmokeResult,
  now: Date,
): WhatsAppSyntheticSmokeResult {
  if (
    result.status !== "pending" ||
    result.timeoutAt === null ||
    result.timeoutAt === undefined ||
    result.timeoutAt > now
  ) {
    return result;
  }
  const steps = result.steps.map((step) =>
    step.status !== "pending" &&
    !(
      result.requireRealRoundtrip === true &&
      step.status === "skipped" &&
      isRoundtripStep(step.code)
    )
      ? step
      : {
          ...step,
          message: "El Contacto no completó este paso antes del timeout",
          observedAt: now,
          status: "failed" as const,
        },
  );
  const timedOutSteps = steps.filter(
    (step) =>
      step.status === "failed" &&
      (result.requireRealRoundtrip !== true ||
        isBlockingRealSmokeStep(step.code)),
  );
  const blockers = [
    ...result.blockers,
    ...timedOutSteps.map((step) => ({
      code: `${step.code}-timeout`,
      message: `Venció el timeout del paso ${whatsappSyntheticSmokeStepLabels[step.code]}`,
    })),
  ];
  return sanitizeWhatsAppSyntheticSmokeResult({
    ...result,
    blockers,
    providerTransportVerified: false,
    status: "failed",
    steps,
    timedOutAt: now,
  });
}

/** Redacta secretos antes de que el resultado llegue a UI, auditoría o JSONB. */
export function sanitizeWhatsAppSyntheticSmokeResult(
  result: WhatsAppSyntheticSmokeResult,
): WhatsAppSyntheticSmokeResult {
  return {
    ...result,
    blockers: result.blockers.map((blocker) => ({
      code: sanitizeOperationalText(blocker.code) ?? "smoke",
      message: sanitizeOperationalText(blocker.message) ?? "Smoke fallido",
    })),
    evidence: sanitizeOperationalText(result.evidence),
    steps: result.steps.map((step) => ({
      ...step,
      evidence: sanitizeOperationalText(step.evidence),
      eventId: sanitizeOperationalText(step.eventId),
      message: sanitizeOperationalText(step.message),
      ...(step.templateName === undefined
        ? {}
        : {
            templateName: sanitizeOperationalText(step.templateName) ?? "",
          }),
      ...(step.consentReference === undefined
        ? {}
        : {
            consentReference:
              sanitizeOperationalText(step.consentReference) ?? "",
          }),
      ...(step.consentAcceptedAt === undefined
        ? {}
        : {
            consentAcceptedAt:
              sanitizeOperationalText(step.consentAcceptedAt) ?? "",
          }),
      ...(step.consentTermsVersion === undefined
        ? {}
        : {
            consentTermsVersion:
              sanitizeOperationalText(step.consentTermsVersion) ?? "",
          }),
      ...(step.consentPrivacyVersion === undefined
        ? {}
        : {
            consentPrivacyVersion:
              sanitizeOperationalText(step.consentPrivacyVersion) ?? "",
          }),
      ...(step.consentTextReference === undefined
        ? {}
        : {
            consentTextReference:
              sanitizeOperationalText(step.consentTextReference) ?? "",
          }),
      ...(step.providerMessageId === undefined
        ? {}
        : {
            providerMessageId:
              sanitizeOperationalText(step.providerMessageId) ?? "",
          }),
      ...(step.providerTemplateId === undefined
        ? {}
        : {
            providerTemplateId:
              sanitizeOperationalText(step.providerTemplateId) ?? "",
          }),
      ...(step.templateLocale === undefined
        ? {}
        : {
            templateLocale: sanitizeOperationalText(step.templateLocale) ?? "",
          }),
    })),
    testContactMaskedPhone: sanitizeOperationalText(
      result.testContactMaskedPhone,
    ),
  };
}

function isRoundtripStep(code: WhatsAppSyntheticSmokeStepCode) {
  return (
    whatsappSyntheticSmokeRoundtripStepCodes as readonly string[]
  ).includes(code);
}

function isBlockingRealSmokeStep(code: WhatsAppSyntheticSmokeStepCode) {
  return isRoundtripStep(code) || code === "real-template-delivery";
}

function requiresProviderEventReference(code: WhatsAppSyntheticSmokeStepCode) {
  return isRoundtripStep(code) || code === "real-template-delivery";
}

function hasBlockingFailedStep(
  steps: WhatsAppSyntheticSmokeStep[],
  requireRealRoundtrip: boolean,
) {
  return steps.some(
    (step) =>
      step.status === "failed" &&
      (!requireRealRoundtrip || isBlockingRealSmokeStep(step.code)),
  );
}

function hasRequiredPendingStep(
  steps: WhatsAppSyntheticSmokeStep[],
  requireRealRoundtrip: boolean,
) {
  return steps.some(
    (step) =>
      (step.status === "pending" &&
        (isRoundtripStep(step.code) ||
          step.code === "real-template-delivery")) ||
      (requireRealRoundtrip &&
        isRoundtripStep(step.code) &&
        step.status === "skipped"),
  );
}

function hasVerifiedProviderRoundtrip(steps: WhatsAppSyntheticSmokeStep[]) {
  return whatsappSyntheticSmokeRoundtripStepCodes.every((code) => {
    const step = steps.find((candidate) => candidate.code === code);
    return (
      step?.status === "passed" &&
      step.source === (code === "real-processing" ? "application" : "provider")
    );
  });
}

function normalizeOperationalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

function sanitizeOperationalText(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const sanitized = sanitizeWhatsAppOperationalText(value);
  return sanitized === "" ? null : sanitized;
}
