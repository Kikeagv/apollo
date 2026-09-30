import { describe, expect, it } from "vitest";

import {
  buildWhatsAppConsentPolicy,
  isWhatsAppConsentCurrent,
  WHATSAPP_CONSENT_PROVIDER,
  type WhatsAppConsentEvidence,
} from "./whatsapp-consent";

const policy = buildWhatsAppConsentPolicy("2.0");

function consent(
  overrides: Partial<WhatsAppConsentEvidence> = {},
): WhatsAppConsentEvidence {
  return {
    acceptedAt: new Date("2026-09-20T12:00:00.000Z"),
    acceptedRole: "contact",
    clinicId: "clinic-1",
    contactId: "contact-1",
    declaration: "CONTINUAR",
    id: "consent-1",
    identityId: "identity-1",
    interactionId: "message-1",
    patientId: null,
    phoneE164: "+50370000002",
    privacyVersion: policy.privacyVersion,
    provider: WHATSAPP_CONSENT_PROVIDER,
    scope: "contact",
    status: "accepted",
    termsVersion: policy.termsVersion,
    textReference: policy.immutableTextReference,
    ...overrides,
  };
}

describe("consentimiento de WhatsApp del Contacto", () => {
  it("acepta evidencia del Contacto aunque hayan cambiado los términos", () => {
    expect(
      isWhatsAppConsentCurrent(
        consent({ termsVersion: "1.0", textReference: "old-reference" }),
        policy,
      ),
    ).toBe(true);
  });

  it.each([
    ["revocada", { status: "revoked" }],
    ["otro rol", { acceptedRole: "tutor" }],
    ["declaración distinta", { declaration: "ACEPTO" }],
    ["otra versión de privacidad", { privacyVersion: "0.9" }],
    ["alcance histórico por Paciente", { scope: "patient", patientId: "patient-1" }],
    ["alcance de canal legado", { scope: "patient", patientId: null }],
    ["asociada a un Paciente", { patientId: "patient-1" }],
  ] as const)("rechaza evidencia %s", (_label, override) => {
    expect(
      isWhatsAppConsentCurrent(
        consent(override as Partial<WhatsAppConsentEvidence>),
        policy,
      ),
    ).toBe(false);
  });
});
