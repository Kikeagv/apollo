import { describe, expect, it } from "vitest";

import {
  buildWhatsAppConsentPolicy,
  isWhatsAppConsentCurrent,
  isWhatsAppPatientConsentCurrent,
  WHATSAPP_CONSENT_PROVIDER,
  WHATSAPP_ADULT_PATIENT_CONSENT_DECLARATION,
  type WhatsAppConsentEvidence,
} from "./whatsapp-consent";

const policy = buildWhatsAppConsentPolicy("2.0");

function patientConsent(
  overrides: Partial<WhatsAppConsentEvidence> = {},
): WhatsAppConsentEvidence {
  return {
    acceptedAt: new Date("2026-09-20T12:00:00.000Z"),
    acceptedRole: "adult-patient",
    clinicId: "clinic-1",
    contactId: "contact-1",
    declaration: WHATSAPP_ADULT_PATIENT_CONSENT_DECLARATION,
    id: "consent-1",
    identityId: "identity-1",
    interactionId: "message-1",
    patientId: "patient-1",
    phoneE164: "+50370000002",
    privacyVersion: policy.privacyVersion,
    provider: WHATSAPP_CONSENT_PROVIDER,
    scope: "patient",
    status: "accepted",
    termsVersion: policy.termsVersion,
    textReference: policy.immutableTextReference,
    ...overrides,
  };
}

describe("consentimiento de WhatsApp por Paciente", () => {
  it("solo acepta evidencia de canal con rol Contacto y declaración explícitos", () => {
    const channelEvidence = patientConsent({
      acceptedRole: "contact",
      declaration: "CONTINUAR",
      patientId: null,
      scope: "channel",
    });

    expect(isWhatsAppConsentCurrent(channelEvidence, policy)).toBe(true);
    expect(
      isWhatsAppConsentCurrent(
        { ...channelEvidence, acceptedRole: "tutor" },
        policy,
      ),
    ).toBe(false);
  });

  it("acepta evidencia vigente del Paciente y rol esperados", () => {
    expect(
      isWhatsAppPatientConsentCurrent(patientConsent(), policy, {
        patientId: "patient-1",
        acceptedRole: "adult-patient",
      }),
    ).toBe(true);
  });

  it.each([
    ["otro Paciente", { patientId: "patient-2" }],
    ["otro rol", { acceptedRole: "tutor" }],
    ["declaración ausente", { declaration: "" }],
    ["otra versión", { termsVersion: "1.0" }],
    ["opt-out", { status: "revoked" }],
    ["alcance del canal", { scope: "channel", patientId: null }],
  ] as const)("bloquea evidencia con %s", (_label, override) => {
    expect(
      isWhatsAppPatientConsentCurrent(
        patientConsent(override as Partial<WhatsAppConsentEvidence>),
        policy,
        { patientId: "patient-1", acceptedRole: "adult-patient" },
      ),
    ).toBe(false);
  });
});
