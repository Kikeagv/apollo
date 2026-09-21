import { and, desc, eq, isNull } from "drizzle-orm";

import { isAdultPatient } from "~/domain/patient";
import {
  buildWhatsAppConsentPolicy,
  isWhatsAppGuardianDeclaration,
  isWhatsAppConsentCurrent,
  isWhatsAppPatientConsentCurrent,
  WHATSAPP_CONSENT_PROVIDER,
} from "~/domain/whatsapp-consent";
import type { ClinicTransaction } from "~/server/db/clinic-context";
import {
  contactPatientLinks,
  clinicTermsContract,
  patients,
  whatsappContactConsents,
} from "~/server/db/schema";

export type WhatsAppConsentSnapshot = {
  acceptedAt: Date | null;
  decision: "allowed" | "blocked";
  patientAcceptedAt: Date | null;
  patientReference: string | null;
  reference: string;
  privacyVersion: string;
  termsVersion: string;
  textReference: string;
};

/** Congela la evidencia mínima necesaria para auditar una Entrega futura. */
export async function readWhatsAppConsentSnapshot(
  transaction: ClinicTransaction,
  input: {
    clinicId: string;
    contactId: string;
    now: Date;
    patientId?: string | null;
  },
): Promise<WhatsAppConsentSnapshot> {
  const contract = await transaction.query.clinicTermsContract.findFirst({
    columns: { currentVersion: true },
    where: eq(clinicTermsContract.id, true),
  });
  const policy = buildWhatsAppConsentPolicy(
    contract?.currentVersion ?? "unknown",
  );
  const [consent] = await transaction
    .select({
      acceptedAt: whatsappContactConsents.acceptedAt,
      contactId: whatsappContactConsents.contactId,
      declaration: whatsappContactConsents.declaration,
      id: whatsappContactConsents.id,
      identityId: whatsappContactConsents.identityId,
      interactionId: whatsappContactConsents.interactionId,
      patientId: whatsappContactConsents.patientId,
      phoneE164: whatsappContactConsents.phoneE164,
      privacyVersion: whatsappContactConsents.privacyVersion,
      provider: whatsappContactConsents.provider,
      scope: whatsappContactConsents.scope,
      status: whatsappContactConsents.status,
      termsVersion: whatsappContactConsents.termsVersion,
      textReference: whatsappContactConsents.textReference,
      clinicId: whatsappContactConsents.clinicId,
      acceptedRole: whatsappContactConsents.acceptedRole,
    })
    .from(whatsappContactConsents)
    .where(
      and(
        eq(whatsappContactConsents.clinicId, input.clinicId),
        eq(whatsappContactConsents.contactId, input.contactId),
        eq(whatsappContactConsents.scope, "channel"),
        isNull(whatsappContactConsents.patientId),
      ),
    )
    .orderBy(
      desc(whatsappContactConsents.acceptedAt),
      desc(whatsappContactConsents.createdAt),
      desc(whatsappContactConsents.id),
    )
    .limit(1);
  const allowed =
    consent !== undefined &&
    consent.acceptedAt <= input.now &&
    consent.provider === WHATSAPP_CONSENT_PROVIDER &&
    isWhatsAppConsentCurrent(consent, policy);
  let patientConsent: typeof whatsappContactConsents.$inferSelect | undefined;
  let patientRole: "adult-patient" | "tutor" | null = null;
  if (input.patientId !== undefined && input.patientId !== null) {
    const [link] = await transaction
      .select({
        birthDate: patients.birthDate,
        guardianDeclaration: contactPatientLinks.guardianDeclaration,
        guardianDui: contactPatientLinks.guardianDui,
        guardianshipVerificationStatus:
          contactPatientLinks.guardianshipVerificationStatus,
        relationship: contactPatientLinks.relationship,
      })
      .from(contactPatientLinks)
      .innerJoin(
        patients,
        and(
          eq(contactPatientLinks.clinicId, patients.clinicId),
          eq(contactPatientLinks.patientId, patients.id),
        ),
      )
      .where(
        and(
          eq(contactPatientLinks.clinicId, input.clinicId),
          eq(contactPatientLinks.contactId, input.contactId),
          eq(contactPatientLinks.patientId, input.patientId),
        ),
      )
      .limit(1);
    if (link?.relationship === "tutor") {
      patientRole =
        link.guardianshipVerificationStatus === "verified" &&
        link.guardianDui !== null &&
        /^\d{8}-\d$/.test(link.guardianDui) &&
        isWhatsAppGuardianDeclaration(link.guardianDeclaration ?? "")
          ? "tutor"
          : null;
    } else if (
      link?.relationship === "contact" &&
      link.birthDate !== null &&
      isAdultPatient(link.birthDate, input.now)
    ) {
      patientRole = "adult-patient";
    }
    if (patientRole !== null) {
      const [latestPatientConsent] = await transaction
        .select()
        .from(whatsappContactConsents)
        .where(
          and(
            eq(whatsappContactConsents.clinicId, input.clinicId),
            eq(whatsappContactConsents.contactId, input.contactId),
            eq(whatsappContactConsents.scope, "patient"),
            eq(whatsappContactConsents.patientId, input.patientId),
          ),
        )
        .orderBy(
          desc(whatsappContactConsents.acceptedAt),
          desc(whatsappContactConsents.createdAt),
          desc(whatsappContactConsents.id),
        )
        .limit(1);
      patientConsent = latestPatientConsent;
    }
  }
  const patientAllowed =
    input.patientId === undefined
      ? true
      : input.patientId !== null &&
        patientConsent !== undefined &&
        patientRole !== null &&
        patientConsent.acceptedAt <= input.now &&
        patientConsent.provider === WHATSAPP_CONSENT_PROVIDER &&
        isWhatsAppPatientConsentCurrent(patientConsent, policy, {
          acceptedRole: patientRole,
          patientId: input.patientId,
        });
  return {
    acceptedAt: consent?.acceptedAt ?? null,
    decision: allowed && patientAllowed ? "allowed" : "blocked",
    patientAcceptedAt: patientConsent?.acceptedAt ?? null,
    patientReference: patientConsent?.id ?? null,
    reference: consent?.id ?? `policy:${policy.immutableTextReference}`,
    privacyVersion: policy.privacyVersion,
    termsVersion: policy.termsVersion,
    textReference: policy.immutableTextReference,
  };
}

/** Consulta RLS compartida por los workers que pueden enviar por WhatsApp. */
export async function hasCurrentWhatsAppConsent(
  transaction: ClinicTransaction,
  input: {
    clinicId: string;
    contactId: string;
    now: Date;
    patientId: string;
  },
) {
  return (
    (await readWhatsAppConsentSnapshot(transaction, input)).decision ===
    "allowed"
  );
}
