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

export type WhatsAppConsentSnapshot = {
  acceptedAt: Date | null;
  decision: "allowed" | "blocked";
  reference: string;
  privacyVersion: string;
  termsVersion: string;
  textReference: string;
};

/** Congela la evidencia mínima necesaria para auditar una Entrega futura. */
export async function readWhatsAppConsentSnapshot(
  transaction: ClinicTransaction,
  input: { clinicId: string; contactId: string; now: Date },
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
  return {
    acceptedAt: consent?.acceptedAt ?? null,
    decision: allowed ? "allowed" : "blocked",
    reference: consent?.id ?? `policy:${policy.immutableTextReference}`,
    privacyVersion: policy.privacyVersion,
    termsVersion: policy.termsVersion,
    textReference: policy.immutableTextReference,
  };
}

/** Consulta RLS compartida por los workers que pueden enviar por WhatsApp. */
export async function hasCurrentWhatsAppConsent(
  transaction: ClinicTransaction,
  input: { clinicId: string; contactId: string; now: Date },
) {
  return (
    (await readWhatsAppConsentSnapshot(transaction, input)).decision ===
    "allowed"
  );
}
