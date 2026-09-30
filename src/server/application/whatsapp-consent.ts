import {
  isWhatsAppConsentAffirmation,
  isWhatsAppConsentCurrent,
  isWhatsAppConsentOptOut,
  whatsappConsentPrompt,
  WHATSAPP_CONSENT_PROVIDER,
  WHATSAPP_CONSENT_TEXTUAL_RESPONSE,
  type WhatsAppConsentEvidence,
  type WhatsAppConsentPolicy,
} from "~/domain/whatsapp-consent";

export type WhatsAppConsentStore = {
  findLatestWhatsAppConsent(input: {
    clinicId: string;
    contactId: string;
  }): Promise<WhatsAppConsentEvidence | null>;
  readCurrentWhatsAppConsentPolicy(input: {
    clinicId: string;
  }): Promise<WhatsAppConsentPolicy | undefined>;
  recordWhatsAppConsent(input: {
    acceptedAt: Date;
    clinicId: string;
    contactId: string;
    declaration: string;
    identityId: string;
    interactionId: string;
    phoneE164: string | null;
    policy: WhatsAppConsentPolicy;
    status?: "accepted" | "revoked";
  }): Promise<WhatsAppConsentEvidence>;
};

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

/** Gestiona una sola decisión de consentimiento, propiedad del Contacto. */
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
          clinicId: input.clinicId,
          contactId: input.contactId,
          declaration: input.text ?? "No me escriban más",
          identityId: input.identityId,
          interactionId: input.messageId,
          phoneE164: input.phoneE164,
          policy,
          status: "revoked",
        });
        if (
          recorded.provider !== WHATSAPP_CONSENT_PROVIDER ||
          recorded.scope !== "contact" ||
          recorded.patientId !== null ||
          recorded.acceptedRole !== "contact" ||
          recorded.status !== "revoked"
        ) {
          return {
            kind: "blocked",
            reason: "La evidencia de opt-out tiene un alcance inválido",
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
        clinicId: input.clinicId,
        contactId: input.contactId,
        declaration: WHATSAPP_CONSENT_TEXTUAL_RESPONSE,
        identityId: input.identityId,
        interactionId: input.messageId,
        phoneE164: input.phoneE164,
        policy,
        status: "accepted",
      });
      if (
        recorded.acceptedAt > input.now ||
        !isWhatsAppConsentCurrent(recorded, policy)
      ) {
        return {
          kind: "blocked",
          reason: "No se pudo validar la evidencia de consentimiento del Contacto",
        };
      }
      return { consume: true, kind: "accepted", reference: recorded.id };
    },
  };
}
