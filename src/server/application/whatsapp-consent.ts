import {
  isWhatsAppConsentAffirmation,
  isWhatsAppConsentCurrent,
  whatsappConsentPrompt,
  WHATSAPP_CONSENT_PROVIDER,
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
    identityId: string;
    interactionId: string;
    patientId: string | null;
    phoneE164: string | null;
    policy: WhatsAppConsentPolicy;
    scope: WhatsAppConsentScope;
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
  input: { clinicId: string; contactId: string; now: Date },
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
  return (
    evidence !== null &&
    evidence.acceptedAt <= input.now &&
    isWhatsAppConsentCurrent(evidence, policy)
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
        identityId: input.identityId,
        interactionId: input.messageId,
        patientId: null,
        phoneE164: input.phoneE164,
        policy,
        scope: "channel",
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
