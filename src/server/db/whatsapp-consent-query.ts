import { and, desc, eq, isNull } from "drizzle-orm";

import {
  buildWhatsAppConsentPolicy,
  isWhatsAppConsentCurrent,
  WHATSAPP_CONSENT_PROVIDER,
} from "~/domain/whatsapp-consent";
import type { ClinicTransaction } from "~/server/db/clinic-context";
import {
  clinicTermsContract,
  whatsappContactConsents,
} from "~/server/db/schema";

/** Consulta RLS compartida por los workers que pueden enviar por WhatsApp. */
export async function hasCurrentWhatsAppConsent(
  transaction: ClinicTransaction,
  input: { clinicId: string; contactId: string; now: Date },
) {
  const contract = await transaction.query.clinicTermsContract.findFirst({
    columns: { currentVersion: true },
    where: eq(clinicTermsContract.id, true),
  });
  if (contract === undefined) return false;
  const policy = buildWhatsAppConsentPolicy(contract.currentVersion);
  const [consent] = await transaction
    .select({
      acceptedAt: whatsappContactConsents.acceptedAt,
      acceptedRole: whatsappContactConsents.acceptedRole,
      clinicId: whatsappContactConsents.clinicId,
      contactId: whatsappContactConsents.contactId,
      id: whatsappContactConsents.id,
      identityId: whatsappContactConsents.identityId,
      interactionId: whatsappContactConsents.interactionId,
      patientId: whatsappContactConsents.patientId,
      phoneE164: whatsappContactConsents.phoneE164,
      privacyVersion: whatsappContactConsents.privacyVersion,
      provider: whatsappContactConsents.provider,
      scope: whatsappContactConsents.scope,
      termsVersion: whatsappContactConsents.termsVersion,
      textReference: whatsappContactConsents.textReference,
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
  return (
    consent !== undefined &&
    consent.acceptedAt <= input.now &&
    consent.provider === WHATSAPP_CONSENT_PROVIDER &&
    isWhatsAppConsentCurrent(consent, policy)
  );
}
