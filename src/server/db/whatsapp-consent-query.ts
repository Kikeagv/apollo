import { and, desc, eq, isNull } from "drizzle-orm";

import {
  buildWhatsAppConsentPolicy,
  isWhatsAppConsentCurrent,
  WHATSAPP_CONSENT_PROVIDER,
} from "~/domain/whatsapp-consent";
import type { ClinicTransaction } from "~/server/db/clinic-context";
import {
  contactPatientLinks,
  clinicTermsContract,
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
      actorIdentityId: whatsappContactConsents.actorIdentityId,
      contactId: whatsappContactConsents.contactId,
      declaration: whatsappContactConsents.declaration,
      id: whatsappContactConsents.id,
      identityId: whatsappContactConsents.identityId,
      interactionId: whatsappContactConsents.interactionId,
      origin: whatsappContactConsents.origin,
      patientId: whatsappContactConsents.patientId,
      phoneE164: whatsappContactConsents.phoneE164,
      privacyVersion: whatsappContactConsents.privacyVersion,
      provider: whatsappContactConsents.provider,
      scope: whatsappContactConsents.scope,
      sourcePatientId: whatsappContactConsents.sourcePatientId,
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
        eq(whatsappContactConsents.scope, "contact"),
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
  let patientIsLinkedToContact = false;
  if (input.patientId !== undefined && input.patientId !== null) {
    const [link] = await transaction
      .select({
        id: contactPatientLinks.id,
      })
      .from(contactPatientLinks)
      .where(
        and(
          eq(contactPatientLinks.clinicId, input.clinicId),
          eq(contactPatientLinks.contactId, input.contactId),
          eq(contactPatientLinks.patientId, input.patientId),
        ),
      )
      .limit(1);
    patientIsLinkedToContact = link !== undefined;
  }
  const patientAllowed =
    input.patientId === undefined
      ? true
      : input.patientId !== null && patientIsLinkedToContact;
  return {
    acceptedAt: consent?.acceptedAt ?? null,
    decision: allowed && patientAllowed ? "allowed" : "blocked",
    patientAcceptedAt: null,
    patientReference: null,
    reference: consent?.id ?? `policy:${policy.immutableTextReference}`,
    privacyVersion: consent?.privacyVersion ?? policy.privacyVersion,
    termsVersion: consent?.termsVersion ?? policy.termsVersion,
    textReference: consent?.textReference ?? policy.immutableTextReference,
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
