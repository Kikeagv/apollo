import { and, desc, eq } from "drizzle-orm";

import { validateWhatsAppActivationEvidence } from "~/domain/whatsapp-activation";
import { sanitizeWhatsAppOperationalText } from "~/domain/whatsapp-circuit-breaker";
import type { WhatsAppActivationEvidenceStore } from "~/server/application/whatsapp-activation";
import {
  inSuperadminRlsTransaction,
  type ClinicTransaction,
} from "~/server/db/clinic-context";
import {
  apoloAuditEvents,
  whatsappActivationEvidences,
  whatsappProvisioningSteps,
  whatsappReadiness,
} from "~/server/db/schema";

export const drizzleWhatsAppActivationEvidenceStore: WhatsAppActivationEvidenceStore =
  {
    async read(input) {
      return inSuperadminRlsTransaction(input.actorIdentityId, (transaction) =>
        readEvidence(transaction, input.clinicId),
      );
    },

    async record(input) {
      const evidence = validateWhatsAppActivationEvidence({
        criterionCode: input.criterionCode,
        evidenceReference: input.evidenceReference,
        pendingReason: input.pendingReason,
        provisioningEventId: input.provisioningEventId,
        recordedAt: input.now,
        source: input.source,
      });
      await inSuperadminRlsTransaction(
        input.actorIdentityId,
        async (transaction) => {
          await assertProvisioningGenerationBelongsToClinic(
            transaction,
            input.clinicId,
            evidence.provisioningEventId,
          );
          await transaction.insert(whatsappActivationEvidences).values({
            clinicId: input.clinicId,
            criterionCode: evidence.criterionCode,
            evidenceReference: sanitizeEvidence(evidence.evidenceReference),
            pendingReason: sanitizeEvidence(evidence.pendingReason),
            provisioningEventId: evidence.provisioningEventId,
            recordedAt: evidence.recordedAt,
            recordedByIdentityId: input.actorIdentityId,
            source: evidence.source,
            updatedAt: input.now,
          });
          await transaction.insert(apoloAuditEvents).values({
            action: [
              "whatsapp-activation-evidence-recorded",
              `criterion=${evidence.criterionCode}`,
              `source=${evidence.source}`,
              `generation=${evidence.provisioningEventId ?? "pending"}`,
            ].join(";"),
            actorIdentityId: input.actorIdentityId,
            clinicId: input.clinicId,
            occurredAt: input.now,
          });
        },
      );
    },
  };

async function readEvidence(transaction: ClinicTransaction, clinicId: string) {
  const rows = await transaction
    .select()
    .from(whatsappActivationEvidences)
    .where(eq(whatsappActivationEvidences.clinicId, clinicId))
    .orderBy(
      desc(whatsappActivationEvidences.updatedAt),
      desc(whatsappActivationEvidences.recordedAt),
      desc(whatsappActivationEvidences.id),
    );

  const latestByCriterionAndSource = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.criterionCode}:${row.source}`;
    if (!latestByCriterionAndSource.has(key)) {
      latestByCriterionAndSource.set(key, row);
    }
  }

  return [...latestByCriterionAndSource.values()].map((row) => ({
    criterionCode: row.criterionCode,
    evidenceReference: row.evidenceReference,
    pendingReason: row.pendingReason,
    provisioningEventId: row.provisioningEventId,
    recordedAt: row.recordedAt,
    source: row.source,
  }));
}

function sanitizeEvidence(value: string | null | undefined) {
  return value === null || value === undefined
    ? null
    : sanitizeWhatsAppOperationalText(value);
}

async function assertProvisioningGenerationBelongsToClinic(
  transaction: ClinicTransaction,
  clinicId: string,
  provisioningEventId: string | null,
) {
  if (provisioningEventId === null) return;

  const ownedStep = await transaction.query.whatsappProvisioningSteps.findFirst(
    {
      columns: { id: true },
      where: and(
        eq(whatsappProvisioningSteps.clinicId, clinicId),
        eq(whatsappProvisioningSteps.eventId, provisioningEventId),
      ),
    },
  );
  if (ownedStep !== undefined) return;

  const currentReadiness = await transaction.query.whatsappReadiness.findFirst({
    columns: { provisioningEventId: true },
    where: eq(whatsappReadiness.clinicId, clinicId),
  });
  if (currentReadiness?.provisioningEventId === provisioningEventId) return;

  throw new Error(
    "La generación de provisión de WhatsApp no pertenece a la Clínica",
  );
}
