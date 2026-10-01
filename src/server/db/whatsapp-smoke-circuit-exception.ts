import { and, desc, eq, sql } from "drizzle-orm";

import {
  matchesWhatsAppCustomer,
  type WhatsAppInboundMessage,
} from "~/domain/whatsapp-inbound";
import {
  currentWhatsAppNumberHealth,
  isWhatsAppNumberSmokeCheckAllowed,
} from "~/domain/whatsapp-readiness";
import {
  isWhatsAppSmokeRunAwaitingInbound,
  isWhatsAppSmokeRunAwaitingReply,
  parseWhatsAppSmokeChallenge,
  parseWhatsAppSmokeReplyIdempotencyKey,
} from "~/domain/whatsapp-smoke";
import type { ClinicTransaction } from "~/server/db/clinic-context";
import { isWhatsAppSmokeContactEligibleInTransaction } from "~/server/db/whatsapp-smoke-contact";
import {
  clinics,
  contacts,
  whatsappConnections,
  whatsappCircuitBreakers,
  whatsappReadiness,
  whatsappSmokeRuns,
} from "~/server/db/schema";

/**
 * Circuit-breaker exception for one controlled inbound challenge. Every
 * message attribute that identifies the smoke, Contact, and generation is
 * checked again in the worker transaction.
 */
export async function isActiveControlledSmokeChallenge(
  transaction: ClinicTransaction,
  input: {
    connection: typeof whatsappConnections.$inferSelect;
    message: Pick<
      WhatsAppInboundMessage,
      "connectionReference" | "customerReference" | "phoneE164" | "text"
    >;
    now: Date;
  },
) {
  const runId = parseWhatsAppSmokeChallenge(input.message.text);
  if (
    runId === null ||
    input.message.connectionReference !== input.connection.phoneNumberId ||
    !matchesWhatsAppCustomer({
      connectionCustomerReference: input.connection.customer,
      messageCustomerReference: input.message.customerReference,
    }) ||
    input.message.phoneE164 === null
  ) {
    return false;
  }
  const run = await readCurrentControlledSmokeRun(transaction, {
    clinicId: input.connection.clinicId,
    connection: input.connection,
    now: input.now,
  });
  if (
    !isWhatsAppSmokeRunAwaitingInbound({
      now: input.now,
      provisioningEventId:
        input.connection.metadata.provisioningEventId ?? null,
      run,
      runId,
    }) ||
    run?.testContactId == null
  ) {
    return false;
  }
  const [contact, eligible] = await Promise.all([
    transaction.query.contacts.findFirst({
      columns: { phoneE164: true },
      where: and(
        eq(contacts.clinicId, input.connection.clinicId),
        eq(contacts.id, run.testContactId),
      ),
    }),
    isWhatsAppSmokeContactEligibleInTransaction(transaction, {
      clinicId: input.connection.clinicId,
      contactId: run.testContactId,
    }),
  ]);
  return (
    contact !== undefined &&
    contact.phoneE164 !== null &&
    contact.phoneE164 === input.message.phoneE164 &&
    eligible
  );
}

/** Allows the one reply tied to the same live controlled smoke run. */
export async function isActiveControlledSmokeReply(
  transaction: ClinicTransaction,
  input: {
    clinicId: string;
    connection?: typeof whatsappConnections.$inferSelect;
    idempotencyKey: string;
    now: Date;
    recipientPhoneE164: string | null;
  },
) {
  const runId = parseWhatsAppSmokeReplyIdempotencyKey(input.idempotencyKey);
  if (runId === null || input.recipientPhoneE164 === null) return false;
  const connection =
    input.connection ??
    (await transaction.query.whatsappConnections.findFirst({
      where: and(
        eq(whatsappConnections.clinicId, input.clinicId),
        eq(whatsappConnections.provider, "kapso"),
      ),
    }));
  if (connection === undefined) return false;
  const run = await readCurrentControlledSmokeRun(transaction, {
    clinicId: input.clinicId,
    connection,
    now: input.now,
  });
  if (
    !isWhatsAppSmokeRunAwaitingReply({
      now: input.now,
      provisioningEventId: connection.metadata.provisioningEventId ?? null,
      run,
      runId,
    }) ||
    run?.testContactId == null
  ) {
    return false;
  }
  const [contact, eligible] = await Promise.all([
    transaction.query.contacts.findFirst({
      columns: { phoneE164: true },
      where: and(
        eq(contacts.clinicId, input.clinicId),
        eq(contacts.id, run.testContactId),
      ),
    }),
    isWhatsAppSmokeContactEligibleInTransaction(transaction, {
      clinicId: input.clinicId,
      contactId: run.testContactId,
    }),
  ]);
  return (
    contact !== undefined &&
    contact.phoneE164 !== null &&
    contact.phoneE164 === input.recipientPhoneE164 &&
    eligible
  );
}

async function readCurrentControlledSmokeRun(
  transaction: ClinicTransaction,
  input: {
    clinicId: string;
    connection: typeof whatsappConnections.$inferSelect;
    now: Date;
  },
) {
  await transaction.execute(
    // The worker sees clinic data only after setting the per-transaction RLS context.
    sql`select set_config('app.clinic_id', ${input.clinicId}, true)`,
  );
  const clinic = await transaction.query.clinics.findFirst({
    columns: { isSynthetic: true, subscriptionStatus: true },
    where: eq(clinics.id, input.clinicId),
  });
  if (clinic?.subscriptionStatus !== "active") return undefined;
  await transaction.execute(
    sql`select set_config('app.subscription_status', ${clinic.subscriptionStatus}, true)`,
  );
  if (
    clinic.isSynthetic ||
    input.connection.clinicId !== input.clinicId ||
    input.connection.provider !== "kapso" ||
    input.connection.phoneNumberId === null ||
    input.connection.realTrafficStatus === "offboarded" ||
    (input.connection.status !== "ready" &&
      input.connection.status !== "blocked") ||
    !isWhatsAppNumberSmokeCheckAllowed(input.connection.metadata.health) ||
    input.connection.metadata.webhookStatus !== "ready"
  ) {
    return undefined;
  }
  await transaction.execute(
    sql`select set_config('app.whatsapp_inbound_smoke_read', 'true', true)`,
  );
  const [readiness, circuit, latestRuns] = await Promise.all([
    transaction.query.whatsappReadiness.findFirst({
      where: eq(whatsappReadiness.clinicId, input.clinicId),
    }),
    transaction.query.whatsappCircuitBreakers.findFirst({
      columns: { status: true },
      where: eq(whatsappCircuitBreakers.clinicId, input.clinicId),
    }),
    transaction
      .select()
      .from(whatsappSmokeRuns)
      .where(eq(whatsappSmokeRuns.clinicId, input.clinicId))
      .orderBy(desc(whatsappSmokeRuns.startedAt))
      .limit(1),
  ]);
  const currentHealth =
    readiness === undefined
      ? "unknown"
      : currentWhatsAppNumberHealth({
          health: readiness.numberHealth,
          healthCheckedAt: readiness.numberHealthCheckedAt,
          now: input.now,
        });
  // The Connection reason describes readiness; the breaker reason describes
  // the operational cut. They are separate gates, so compare their states.
  const blockedByCurrentCircuit =
    input.connection.status !== "blocked" || circuit?.status === "open";
  if (
    readiness === undefined ||
    !blockedByCurrentCircuit ||
    readiness.numberEnvironment !== "production" ||
    !isWhatsAppNumberSmokeCheckAllowed(currentHealth) ||
    !isWhatsAppNumberSmokeCheckAllowed(input.connection.metadata.health) ||
    input.connection.businessAccountId === null ||
    readiness.businessAccountId !== input.connection.businessAccountId ||
    readiness.projectWebhookStatus !== "ready" ||
    readiness.phoneNumberWebhookStatus !== "ready" ||
    readiness.phoneNumberId !== input.connection.phoneNumberId ||
    readiness.projectId === null ||
    readiness.projectId !== (input.connection.metadata.projectId ?? null) ||
    readiness.projectWebhookId === null ||
    readiness.phoneNumberWebhookId === null ||
    readiness.provisioningEventId === null ||
    readiness.provisioningEventId !==
      (input.connection.metadata.provisioningEventId ?? null)
  ) {
    return undefined;
  }
  const run = latestRuns[0];
  if (
    run?.provisioningEventId !== readiness.provisioningEventId ||
    run?.timeoutAt == null ||
    run.timeoutAt <= input.now
  ) {
    return undefined;
  }
  return run;
}
