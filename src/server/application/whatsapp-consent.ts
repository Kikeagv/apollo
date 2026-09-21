import {
  isWhatsAppAdultPatientConsentDeclaration,
  isWhatsAppConsentAffirmation,
  isWhatsAppConsentCurrent,
  isWhatsAppConsentOptOut,
  isWhatsAppPatientConsentCurrent,
  isWhatsAppTutorPatientConsentDeclaration,
  whatsappConsentPrompt,
  WHATSAPP_ADULT_PATIENT_CONSENT_DECLARATION,
  WHATSAPP_CONSENT_PROVIDER,
  WHATSAPP_TUTOR_PATIENT_CONSENT_DECLARATION,
  type WhatsAppConsentAcceptedRole,
  type WhatsAppConsentEvidence,
  type WhatsAppConsentPolicy,
  type WhatsAppConsentScope,
} from "~/domain/whatsapp-consent";

export type WhatsAppConsentStore = {
  findLatestWhatsAppConsent(input: {
    clinicId: string;
    contactId: string;
    patientId: string | null;
    scope: WhatsAppConsentScope;
  }): Promise<WhatsAppConsentEvidence | null>;
  readCurrentWhatsAppConsentPolicy(input: {
    clinicId: string;
  }): Promise<WhatsAppConsentPolicy | undefined>;
  recordWhatsAppConsent(input: {
    acceptedAt: Date;
    acceptedRole: WhatsAppConsentAcceptedRole;
    clinicId: string;
    contactId: string;
    declaration: string;
    identityId: string;
    interactionId: string;
    patientId: string | null;
    phoneE164: string | null;
    policy: WhatsAppConsentPolicy;
    scope: WhatsAppConsentScope;
    status?: "accepted" | "revoked";
  }): Promise<WhatsAppConsentEvidence>;
};

export type WhatsAppPatientConsentEligibility =
  "adult-patient" | "tutor" | "tutor-pending" | null;

export type WhatsAppPatientConsentStore = WhatsAppConsentStore & {
  findWhatsAppPatientConsentEligibility(input: {
    clinicId: string;
    contactId: string;
    now: Date;
    patientId: string;
  }): Promise<WhatsAppPatientConsentEligibility>;
};

export type WhatsAppPatientConsentDecision =
  | {
      acceptedRole: "adult-patient" | "tutor";
      kind: "accepted";
      reference: string;
    }
  | {
      code:
        | "guardian-verification-required"
        | "identity-unverified"
        | "invalid-evidence"
        | "policy-unavailable"
        | "unauthorized-link";
      kind: "blocked";
      reason: string;
    }
  | { kind: "pending"; prompt: string };

/** Registra consentimiento actual de un Paciente sin saltar la verificación de tutela. */
export function createWhatsAppPatientConsentGate(
  store: WhatsAppPatientConsentStore,
) {
  return {
    async check(input: {
      clinicId: string;
      contactId: string;
      declaration: string;
      identityId: string | undefined;
      interactionId: string;
      now: Date;
      patientId: string;
      phoneE164: string | null;
    }): Promise<WhatsAppPatientConsentDecision> {
      const eligibility = await store.findWhatsAppPatientConsentEligibility({
        clinicId: input.clinicId,
        contactId: input.contactId,
        now: input.now,
        patientId: input.patientId,
      });
      if (eligibility === "tutor-pending") {
        return {
          code: "guardian-verification-required",
          kind: "blocked",
          reason: "La Clínica debe verificar la representación del Tutor",
        };
      }
      if (eligibility === null) {
        return {
          code: "unauthorized-link",
          kind: "blocked",
          reason: "El Contacto no tiene un vínculo autorizado con el Paciente",
        };
      }
      const expectedDeclaration =
        eligibility === "adult-patient"
          ? WHATSAPP_ADULT_PATIENT_CONSENT_DECLARATION
          : WHATSAPP_TUTOR_PATIENT_CONSENT_DECLARATION;
      const policy = await store.readCurrentWhatsAppConsentPolicy({
        clinicId: input.clinicId,
      });
      if (policy === undefined) {
        return {
          code: "policy-unavailable",
          kind: "blocked",
          reason: "La Clínica no tiene una política de consentimiento vigente",
        };
      }
      const latest = await store.findLatestWhatsAppConsent({
        clinicId: input.clinicId,
        contactId: input.contactId,
        patientId: input.patientId,
        scope: "patient",
      });
      if (
        latest !== null &&
        latest.acceptedAt <= input.now &&
        isWhatsAppPatientConsentCurrent(latest, policy, {
          acceptedRole: eligibility,
          patientId: input.patientId,
        })
      ) {
        return {
          acceptedRole: eligibility,
          kind: "accepted",
          reference: latest.id,
        };
      }
      const matchesDeclaration =
        eligibility === "adult-patient"
          ? isWhatsAppAdultPatientConsentDeclaration(input.declaration)
          : isWhatsAppTutorPatientConsentDeclaration(input.declaration);
      if (!matchesDeclaration) {
        return {
          kind: "pending",
          prompt: `Para el Paciente seleccionado, responda exactamente: consentir paciente|${expectedDeclaration}`,
        };
      }
      if (input.identityId === undefined || input.identityId.trim() === "") {
        return {
          code: "identity-unverified",
          kind: "blocked",
          reason: "No se pudo verificar la Identidad de WhatsApp del Contacto",
        };
      }

      const recorded = await store.recordWhatsAppConsent({
        acceptedAt: input.now,
        acceptedRole: eligibility,
        clinicId: input.clinicId,
        contactId: input.contactId,
        declaration: input.declaration.trim(),
        identityId: input.identityId,
        interactionId: input.interactionId,
        patientId: input.patientId,
        phoneE164: input.phoneE164,
        policy,
        scope: "patient",
        status: "accepted",
      });
      if (
        recorded.acceptedAt > input.now ||
        !isWhatsAppPatientConsentCurrent(recorded, policy, {
          acceptedRole: eligibility,
          patientId: input.patientId,
        })
      ) {
        return {
          code: "invalid-evidence",
          kind: "blocked",
          reason:
            "No se pudo validar la evidencia de consentimiento del Paciente",
        };
      }
      return {
        acceptedRole: eligibility,
        kind: "accepted",
        reference: recorded.id,
      };
    },
  };
}

export type WhatsAppConsentCheckInput = {
  clinicId: string;
  contactId: string;
  identityId: string;
  interactiveAction: "continue" | null;
  messageId: string;
  now: Date;
  phoneE164: string | null;
  text: string | null;
};

export type WhatsAppConsentDecision =
  | { consume?: boolean; kind: "accepted"; reference: string }
  | { kind: "revoked"; reference: string }
  | {
      kind: "pending";
      prompt?: { buttonLabel: string; text: string };
    }
  | { kind: "blocked"; reason: string };

export type WhatsAppConsentGate = {
  check(input: WhatsAppConsentCheckInput): Promise<WhatsAppConsentDecision>;
};

export type WhatsAppConsentReader = Pick<
  WhatsAppConsentStore,
  "findLatestWhatsAppConsent" | "readCurrentWhatsAppConsentPolicy"
>;

/** El outbox usa esta lectura para bloquear recordatorios sin opt-in vigente. */
export async function canSendWhatsAppProactiveDelivery(
  input: {
    acceptedRole: Extract<
      WhatsAppConsentAcceptedRole,
      "adult-patient" | "tutor"
    >;
    clinicId: string;
    contactId: string;
    now: Date;
    patientId: string;
  },
  store: WhatsAppConsentReader,
) {
  const policy = await store.readCurrentWhatsAppConsentPolicy({
    clinicId: input.clinicId,
  });
  if (policy === undefined) return false;
  const evidence = await store.findLatestWhatsAppConsent({
    clinicId: input.clinicId,
    contactId: input.contactId,
    patientId: null,
    scope: "channel",
  });
  const channelAllowed =
    evidence !== null &&
    evidence.acceptedAt <= input.now &&
    isWhatsAppConsentCurrent(evidence, policy);
  if (!channelAllowed) return false;
  const patientConsent = await store.findLatestWhatsAppConsent({
    clinicId: input.clinicId,
    contactId: input.contactId,
    patientId: input.patientId,
    scope: "patient",
  });
  return (
    patientConsent !== null &&
    patientConsent.acceptedAt <= input.now &&
    isWhatsAppPatientConsentCurrent(patientConsent, policy, {
      acceptedRole: input.acceptedRole,
      patientId: input.patientId,
    })
  );
}

/** Fuente de verdad del consentimiento inicial del canal de WhatsApp. */
export function createWhatsAppConsentGate(
  store: WhatsAppConsentStore,
): WhatsAppConsentGate {
  return {
    async check(input) {
      const policy = await store.readCurrentWhatsAppConsentPolicy({
        clinicId: input.clinicId,
      });
      if (policy === undefined) {
        return {
          kind: "blocked",
          reason: "La Clínica no tiene una política de consentimiento vigente",
        };
      }

      const latest = await store.findLatestWhatsAppConsent({
        clinicId: input.clinicId,
        contactId: input.contactId,
        patientId: null,
        scope: "channel",
      });
      const current =
        latest !== null &&
        latest.acceptedAt <= input.now &&
        isWhatsAppConsentCurrent(latest, policy)
          ? latest
          : null;
      const affirmation = isWhatsAppConsentAffirmation(input);

      if (isWhatsAppConsentOptOut(input.text)) {
        const recorded = await store.recordWhatsAppConsent({
          acceptedAt: input.now,
          acceptedRole: "contact",
          clinicId: input.clinicId,
          contactId: input.contactId,
          declaration: input.text ?? "No me escriban más",
          identityId: input.identityId,
          interactionId: input.messageId,
          patientId: null,
          phoneE164: input.phoneE164,
          policy,
          scope: "channel",
          status: "revoked",
        });
        if (recorded.provider !== WHATSAPP_CONSENT_PROVIDER) {
          return {
            kind: "blocked",
            reason: "La evidencia de opt-out tiene un proveedor inválido",
          };
        }
        return { kind: "revoked", reference: recorded.id };
      }

      if (current !== null) {
        return {
          consume: affirmation,
          kind: "accepted",
          reference: current.id,
        };
      }
      if (!affirmation) {
        return {
          kind: "pending",
          prompt: {
            buttonLabel: policy.buttonLabel,
            text: whatsappConsentPrompt(policy),
          },
        };
      }

      const recorded = await store.recordWhatsAppConsent({
        acceptedAt: input.now,
        acceptedRole: "contact",
        clinicId: input.clinicId,
        contactId: input.contactId,
        declaration: input.text?.trim() ?? "CONTINUAR",
        identityId: input.identityId,
        interactionId: input.messageId,
        patientId: null,
        phoneE164: input.phoneE164,
        policy,
        scope: "channel",
        status: "accepted",
      });
      if (recorded.provider !== WHATSAPP_CONSENT_PROVIDER) {
        return {
          kind: "blocked",
          reason: "La evidencia de consentimiento tiene un proveedor inválido",
        };
      }
      return { consume: true, kind: "accepted", reference: recorded.id };
    },
  };
}
