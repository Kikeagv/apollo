import { sanitizeWhatsAppOperationalText } from "./whatsapp-circuit-breaker";

/** Códigos de las comprobaciones sintéticas que habilitan el piloto técnico. */
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
  "consent-version": "Reaparición por cambio de versión",
  "patient-consent-inbound": "Consentimiento por Paciente en inbound",
  "delivery-status": "Estado de delivery",
  duplicate: "Duplicado idempotente",
  "guardian-pending": "Tutor pendiente",
  "guardian-verified": "Tutor verificado y consentimiento por Paciente",
  "history-sync": "History sync ignorado de forma segura",
  "invalid-signature": "Firma inválida",
  "legal-block": "Bloqueo legal",
  "phone-number-created": "Phone number created",
  "patient-selection": "Selección explícita ante ausencia o ambigüedad",
  "rate-limit": "429 y Retry-After",
  reception: "Recepción",
  "real-delivery": "Delivery confirmado del asistente de la clínica",
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

/**
 * Normaliza el contrato del runner y falla cerrado ante pasos ausentes,
 * contactos reales o cualquier intento de habilitar pacientes reales.
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
    if (step === undefined) {
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
          sanitizeOperationalText(step.message) ?? "Paso no aplicable a este runner",
        observedAt: step.observedAt ?? null,
        passed: false,
        source: step.source ?? null,
        status: "skipped",
      } satisfies WhatsAppSyntheticSmokeStep;
    }
    if (status === "failed") {
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
      !isRoundtripStep(code) ||
      input.requireRealRoundtrip !== true ||
      (eventId !== null && observedAt !== null);
    const passed =
      status === "passed" && evidence !== null && hasRoundtripReference;
    if (status === "passed" && (evidence === null || !hasRoundtripReference)) {
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
  const hasFailedStep = steps.some((step) => step.status === "failed");
  const hasPendingStep = steps.some((step) => step.status === "pending");
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
    message?: string | null;
  },
): WhatsAppSyntheticSmokeResult {
  const evidence = sanitizeOperationalText(input.evidence);
  const eventId = sanitizeOperationalText(input.eventId);
  const passed =
    input.status === "passed" &&
    evidence !== null &&
    (!isRoundtripStep(input.code) ||
      (eventId !== null && input.observedAt instanceof Date));
  const status: WhatsAppSyntheticSmokeStep["status"] = passed
    ? "passed"
    : "failed";
  const steps = result.steps.map((step) =>
    step.code === input.code
      ? {
          code: input.code,
          evidence,
          eventId,
          message: sanitizeOperationalText(input.message),
          observedAt: input.observedAt,
          passed,
          source: input.source,
          status,
        }
      : step,
  );
  const blockers = result.blockers.filter(
    (blocker) =>
      blocker.code !== input.code && !blocker.code.startsWith(`${input.code}-`),
  );
  if (!passed) {
    blockers.push({
      code: input.code,
      message:
        sanitizeOperationalText(input.message) ??
        `Falló el paso ${whatsappSyntheticSmokeStepLabels[input.code]}`,
    });
  }
  const providerTransportVerified =
    result.requireRealRoundtrip === true &&
    hasVerifiedProviderRoundtrip(steps);
  return sanitizeWhatsAppSyntheticSmokeResult({
    ...result,
    blockers,
    providerTransportVerified,
    steps,
    status:
      blockers.length > 0 || steps.some((step) => step.status === "failed")
        ? "failed"
        : result.requireRealRoundtrip === true &&
            steps.some((step) => step.status === "pending")
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
    step.status !== "pending"
      ? step
      : {
          ...step,
          message: "El Contacto no completó este paso antes del timeout",
          observedAt: now,
          status: "failed" as const,
        },
  );
  const timedOutSteps = steps.filter((step) => step.status === "failed");
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
