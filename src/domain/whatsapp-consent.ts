import { CLINIC_TERMS_URL } from "./clinic-setup";

export const WHATSAPP_CONSENT_PROVIDER = "kapso" as const;
export const WHATSAPP_CONSENT_BUTTON_LABEL = "CONTINUAR" as const;
export const WHATSAPP_CONSENT_TEXTUAL_RESPONSE = "CONTINUAR" as const;
export const WHATSAPP_MANUAL_PATIENT_REGISTRATION_DECLARATION =
  "REGISTRO_MANUAL_DE_PACIENTE" as const;
export const WHATSAPP_PRIVACY_URL = "https://www.usepraxia.com/privacidad";
export const WHATSAPP_PRIVACY_VERSION = "1.0";
export const WHATSAPP_GUARDIAN_DECLARATION =
  "DECLARO REPRESENTACIÓN AUTORIZADA" as const;

/** `patient` se conserva solo para consultar evidencia histórica. */
export type WhatsAppConsentScope = "contact" | "patient";

export type WhatsAppConsentSafeRoute =
  "frustration" | "human-request" | "urgency";

export type WhatsAppConsentAcceptedRole = "adult-patient" | "contact" | "tutor";
export type WhatsAppConsentOrigin =
  "manual_patient_registration" | "whatsapp_inbound";
export type WhatsAppConsentStatus = "accepted" | "revoked";

export type WhatsAppConsentPolicy = {
  buttonLabel: typeof WHATSAPP_CONSENT_BUTTON_LABEL;
  immutableTextReference: string;
  privacyUrl: string;
  privacyVersion: string;
  termsUrl: string;
  termsVersion: string;
  textualResponse: typeof WHATSAPP_CONSENT_TEXTUAL_RESPONSE;
};

export type WhatsAppConsentEvidence = {
  acceptedAt: Date;
  acceptedRole: WhatsAppConsentAcceptedRole;
  clinicId: string;
  contactId: string;
  declaration: string;
  id: string;
  identityId: string | null;
  interactionId: string;
  origin: WhatsAppConsentOrigin;
  patientId: string | null;
  phoneE164: string | null;
  privacyVersion: string;
  provider: typeof WHATSAPP_CONSENT_PROVIDER;
  actorIdentityId: string | null;
  sourcePatientId: string | null;
  scope: WhatsAppConsentScope;
  status: WhatsAppConsentStatus;
  termsVersion: string;
  textReference: string;
};

export function buildWhatsAppConsentPolicy(
  termsVersion: string,
): WhatsAppConsentPolicy {
  const immutableTextReference = [
    "praxia:whatsapp-consent",
    `privacy=${WHATSAPP_PRIVACY_VERSION}`,
    `terms=${termsVersion}`,
  ].join(";");
  return {
    buttonLabel: WHATSAPP_CONSENT_BUTTON_LABEL,
    immutableTextReference,
    privacyUrl: WHATSAPP_PRIVACY_URL,
    privacyVersion: WHATSAPP_PRIVACY_VERSION,
    termsUrl: CLINIC_TERMS_URL,
    termsVersion,
    textualResponse: WHATSAPP_CONSENT_TEXTUAL_RESPONSE,
  };
}

export function whatsappConsentPrompt(policy: WhatsAppConsentPolicy) {
  return `Revisa el Aviso de privacidad: ${policy.privacyUrl} y las condiciones de la Clínica: ${policy.termsUrl}. Al pulsar ${policy.buttonLabel} aceptas las condiciones y autorizas mensajes administrativos de citas por WhatsApp (confirmaciones, recordatorios, cancelaciones y reprogramaciones) para todos los Pacientes que tienes vinculados con esta Clínica, actuales y futuros.`;
}

export function isWhatsAppConsentAffirmation(input: {
  interactiveAction: "continue" | null;
  text: string | null;
}) {
  return (
    input.interactiveAction === "continue" ||
    input.text?.trim() === WHATSAPP_CONSENT_TEXTUAL_RESPONSE
  );
}

/** Reconoce únicamente la orden explícita que detiene nuevos envíos. */
export function isWhatsAppConsentOptOut(text: string | null) {
  if (text === null) return false;
  const normalized = text
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[.!?]+$/u, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es-SV");
  return normalized === "no me escriban mas";
}

/** Intenciones que siempre tienen una salida segura aun sin habilitar agenda. */
export function classifyWhatsAppConsentSafeRoute(
  text: string | null,
): WhatsAppConsentSafeRoute | null {
  if (text === null) return null;
  if (/\b(emergencia|urgencia)\b/i.test(text)) return "urgency";
  if (
    /\b(hablar\s+con\s+(una\s+)?persona|atenci[oó]n\s+humana|humano|secretaria)\b/i.test(
      text,
    )
  ) {
    return "human-request";
  }
  if (/\b(no\s+sirve|no\s+entiendes|in[úu]til|frustrad[oa])\b/i.test(text)) {
    return "frustration";
  }
  return null;
}

/** Valida el permiso del Contacto, sin invalidarlo por cambios de términos. */
export function isWhatsAppConsentCurrent(
  evidence: WhatsAppConsentEvidence,
  policy: WhatsAppConsentPolicy,
) {
  const hasValidOriginEvidence =
    (evidence.origin === "whatsapp_inbound" &&
      evidence.declaration === WHATSAPP_CONSENT_TEXTUAL_RESPONSE &&
      evidence.actorIdentityId === null &&
      evidence.sourcePatientId === null) ||
    (evidence.origin === "manual_patient_registration" &&
      evidence.declaration ===
        WHATSAPP_MANUAL_PATIENT_REGISTRATION_DECLARATION &&
      evidence.actorIdentityId !== null &&
      evidence.sourcePatientId !== null);

  return (
    evidence.provider === WHATSAPP_CONSENT_PROVIDER &&
    evidence.status === "accepted" &&
    evidence.scope === "contact" &&
    evidence.acceptedRole === "contact" &&
    evidence.patientId === null &&
    hasValidOriginEvidence &&
    evidence.privacyVersion === policy.privacyVersion
  );
}

export function isWhatsAppGuardianDeclaration(value: string) {
  return normalizeWhatsAppDeclaration(value) === WHATSAPP_GUARDIAN_DECLARATION;
}

function normalizeWhatsAppDeclaration(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("es-SV");
}
