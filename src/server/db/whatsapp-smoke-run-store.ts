import { and, eq, or, sql } from "drizzle-orm";

import {
  sanitizeWhatsAppSyntheticSmokeResult,
  expireWhatsAppSyntheticSmoke,
  recordWhatsAppSyntheticSmokeStep,
  type WhatsAppSyntheticSmokeResult,
} from "~/domain/whatsapp-smoke";
import type { ClinicTransaction } from "~/server/db/clinic-context";
import { whatsappSmokeRuns } from "~/server/db/schema";

type SmokeRunRow = typeof whatsappSmokeRuns.$inferSelect;

export function smokeResultFromRow(
  row: SmokeRunRow,
): WhatsAppSyntheticSmokeResult {
  return sanitizeWhatsAppSyntheticSmokeResult({
    blockers: row.blockers,
    controlledTestContact:
      row.requiresRealRoundtrip && row.testContactId !== null,
    evidence: row.evidence,
    providerTransportVerified: row.providerTransportVerified,
    realPatientsEnabled: row.realPatientsEnabled,
    requireRealRoundtrip: row.requiresRealRoundtrip,
    runId: row.id,
    status: row.status,
    steps: row.steps.map((step) => ({
      ...step,
      observedAt: toDate(step.observedAt),
    })),
    syntheticContact: row.syntheticContact,
    testContactId: row.testContactId,
    testContactMaskedPhone: row.testContactMaskedPhone,
    timeoutAt: row.timeoutAt,
    timedOutAt: row.timedOutAt,
  });
}

export async function persistSmokeResult(
  transaction: ClinicTransaction,
  input: {
    clinicId: string;
    finishedAt: Date;
    result: WhatsAppSyntheticSmokeResult;
    runId: string;
    allowTimedOutFailureAt?: Date;
  },
) {
  const result = sanitizeWhatsAppSyntheticSmokeResult(input.result);
  const runStatusCondition =
    input.allowTimedOutFailureAt === undefined
      ? eq(whatsappSmokeRuns.status, "pending")
      : or(
          eq(whatsappSmokeRuns.status, "pending"),
          and(
            eq(whatsappSmokeRuns.status, "failed"),
            eq(whatsappSmokeRuns.timedOutAt, input.allowTimedOutFailureAt),
          ),
        );
  const [updated] = await transaction
    .update(whatsappSmokeRuns)
    .set({
      blockers: result.blockers,
      evidence:
        result.evidence ??
        (result.blockers.length === 0
          ? "Smoke sintético completo"
          : result.blockers.map((blocker) => blocker.message).join("; ")),
      finishedAt: result.status === "pending" ? null : input.finishedAt,
      providerTransportVerified: result.providerTransportVerified === true,
      status: result.status,
      steps: result.steps,
      timedOutAt: result.timedOutAt ?? null,
    })
    .where(
      and(
        eq(whatsappSmokeRuns.clinicId, input.clinicId),
        eq(whatsappSmokeRuns.id, input.runId),
        runStatusCondition,
      ),
    )
    .returning({ id: whatsappSmokeRuns.id });
  return updated !== undefined;
}

export async function recordSmokeReplyOutcome(
  transaction: ClinicTransaction,
  input: {
    clinicId: string;
    idempotencyKey: string;
    now: Date;
    outcome: "accepted" | "delivery-failed" | "delivered" | "read" | "rejected";
    providerEventId?: string | null;
    providerMessageId?: string | null;
  },
) {
  const match = /^whatsapp-smoke:([0-9a-f-]{36}):reply$/i.exec(
    input.idempotencyKey,
  );
  if (match === null) return;
  await transaction.execute(
    sql`select set_config('app.clinic_id', ${input.clinicId}, true)`,
  );
  const [row] = await transaction
    .select()
    .from(whatsappSmokeRuns)
    .where(
      and(
        eq(whatsappSmokeRuns.clinicId, input.clinicId),
        eq(whatsappSmokeRuns.id, match[1]!),
        eq(whatsappSmokeRuns.status, "pending"),
        eq(whatsappSmokeRuns.requiresRealRoundtrip, true),
      ),
    )
    .for("update");
  if (row === undefined) return;
  let result = smokeResultFromRow(row);
  if (row.timeoutAt === null || row.timeoutAt <= input.now) {
    result = expireWhatsAppSyntheticSmoke(result, input.now);
  } else {
    const isResponse =
      input.outcome === "accepted" || input.outcome === "rejected";
    const code = isResponse ? "real-response" : "real-delivery";
    const passed =
      input.outcome !== "delivery-failed" && input.outcome !== "rejected";
    result = recordWhatsAppSyntheticSmokeStep(result, {
      code,
      eventId: input.providerEventId ?? input.providerMessageId,
      evidence:
        input.outcome === "accepted"
          ? "Kapso aceptó la respuesta administrativa"
          : input.outcome === "rejected"
            ? "Kapso no aceptó la respuesta administrativa"
            : input.outcome === "delivery-failed"
              ? "Kapso confirmó un fallo de entrega"
              : "Kapso confirmó la entrega al Contacto",
      message: passed
        ? null
        : isResponse
          ? "Kapso no aceptó la respuesta administrativa"
          : "Kapso confirmó un fallo de entrega",
      observedAt: input.now,
      source: "provider",
      status: passed ? "passed" : "failed",
    });
  }
  await persistSmokeResult(transaction, {
    clinicId: input.clinicId,
    finishedAt: input.now,
    result,
    runId: row.id,
  });
}

function toDate(value: Date | string | null) {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}
