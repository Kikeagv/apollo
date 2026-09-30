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
    actorIdentityId: null,
    clinicId: "clinic-1",
    contactId: "contact-1",
    declaration: "CONTINUAR",
    id: "consent-1",
    identityId: "identity-1",
    interactionId: "message-1",
    origin: "whatsapp_inbound",
    patientId: null,
    phoneE164: "+50370000002",
    privacyVersion: policy.privacyVersion,
    provider: WHATSAPP_CONSENT_PROVIDER,
    sourcePatientId: null,
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

  it("acepta la concesión registrada junto con un Paciente en la Clínica", () => {
    const manualRegistrationConsent = {
      ...consent({
        declaration: "REGISTRO_MANUAL_DE_PACIENTE",
        identityId: null,
      }),
      actorIdentityId: "operator-1",
      origin: "manual_patient_registration",
      sourcePatientId: "patient-1",
    } as unknown as WhatsAppConsentEvidence;

    expect(isWhatsAppConsentCurrent(manualRegistrationConsent, policy)).toBe(
      true,
    );
  });

  it.each([
    ["sin actor", { actorIdentityId: null }],
    ["sin Paciente de origen", { sourcePatientId: null }],
    ["con marca de declaración incorrecta", { declaration: "CONTINUAR" }],
  ] as const)("rechaza la concesión manual %s", (_label, override) => {
    const manualRegistrationConsent = consent({
      declaration: "REGISTRO_MANUAL_DE_PACIENTE",
      identityId: null,
      origin: "manual_patient_registration",
      actorIdentityId: "operator-1",
      sourcePatientId: "patient-1",
      ...override,
    });

    expect(isWhatsAppConsentCurrent(manualRegistrationConsent, policy)).toBe(
      false,
    );
  });

  it.each([
    ["revocada", { status: "revoked" }],
    ["otro rol", { acceptedRole: "tutor" }],
    ["declaración distinta", { declaration: "ACEPTO" }],
    ["otra versión de privacidad", { privacyVersion: "0.9" }],
    [
      "alcance histórico por Paciente",
      { scope: "patient", patientId: "patient-1" },
    ],
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
