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
] as const;

/** Comprobaciones que un adaptador externo puede corroborar adicionalmente. */
export const whatsappSyntheticSmokeProviderStepCodes = [
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
  redirect: "Redirect permitido",
  response: "Respuesta",
  sandbox: "Número sandbox bloqueado",
  template: "Template transaccional",
  "template-status": "Template PENDING/REJECTED/DISABLED bloqueado",
  timeout: "Timeout y reintento",
  takeover: "Takeover humano",
  urgency: "Ruta de urgencia sin consentimiento de agenda",
  "webhook-paused": "Webhook pausado",
  "webhook-retry": "Reintento de webhook",
};

export type WhatsAppSyntheticSmokeStep = {
  code: WhatsAppSyntheticSmokeStepCode;
  evidence: string | null;
  message: string | null;
  passed: boolean;
};

export type WhatsAppSyntheticSmokeResult = {
  blockers: Array<{ code: string; message: string }>;
  evidence: string | null;
  providerTransportVerified?: boolean;
  realPatientsEnabled: boolean;
  status: "failed" | "passed";
  steps: WhatsAppSyntheticSmokeStep[];
  syntheticContact: boolean;
};

export type WhatsAppSyntheticSmokeStepInput = {
  evidence?: string | null;
  message?: string | null;
  passed: boolean;
};

/**
 * Normaliza el contrato del runner y falla cerrado ante pasos ausentes,
 * contactos reales o cualquier intento de habilitar pacientes reales.
 */
export function evaluateWhatsAppSyntheticSmoke(input: {
  evidence?: string | null;
  providerTransportVerified?: boolean;
  realPatientsEnabled: boolean;
  steps: Partial<
    Record<WhatsAppSyntheticSmokeStepCode, WhatsAppSyntheticSmokeStepInput>
  >;
  syntheticContact: boolean;
}): WhatsAppSyntheticSmokeResult {
  const blockers: Array<{ code: string; message: string }> = [];
  const steps = whatsappSyntheticSmokeStepCodes.map((code) => {
    const step = input.steps[code];
    if (step === undefined) {
      blockers.push({
        code,
        message: `El smoke no evidenció el paso ${whatsappSyntheticSmokeStepLabels[code]}`,
      });
      return {
        code,
        evidence: null,
        message: "Paso no ejecutado",
        passed: false,
      } satisfies WhatsAppSyntheticSmokeStep;
    }
    if (!step.passed) {
      blockers.push({
        code,
        message:
          step.message ??
          `Falló el paso ${whatsappSyntheticSmokeStepLabels[code]}`,
      });
    }
    const evidence = normalizeOperationalText(step.evidence);
    const passed = step.passed && evidence !== null;
    if (step.passed && evidence === null) {
      blockers.push({
        code: `${code}-evidence`,
        message: `El paso ${whatsappSyntheticSmokeStepLabels[code]} no tiene evidencia`,
      });
    }
    return {
      code,
      evidence,
      message: normalizeOperationalText(step.message),
      passed,
    } satisfies WhatsAppSyntheticSmokeStep;
  });

  if (!input.syntheticContact) {
    blockers.push({
      code: "synthetic-contact",
      message: "El smoke solo puede ejecutarse con un contacto sintético",
    });
  }
  if (input.realPatientsEnabled) {
    blockers.push({
      code: "real-patients",
      message: "El smoke no puede habilitar Pacientes reales",
    });
  }

  const evidence = input.evidence?.trim();
  return sanitizeWhatsAppSyntheticSmokeResult({
    blockers,
    evidence: evidence === undefined || evidence === "" ? null : evidence,
    providerTransportVerified: input.providerTransportVerified === true,
    realPatientsEnabled: input.realPatientsEnabled,
    status: blockers.length === 0 ? "passed" : "failed",
    steps,
    syntheticContact: input.syntheticContact,
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
      message: sanitizeOperationalText(step.message),
    })),
  };
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
