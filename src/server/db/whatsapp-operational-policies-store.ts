import { sql } from "drizzle-orm";

import type { db } from "~/server/db";
import { configurationAuditEvents } from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function lockWhatsAppOperationalPolicies(
  transaction: ClinicTransaction,
  clinicId: string,
) {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext(${clinicId}))`,
  );
}

export function recordWhatsAppOperationalPolicyAudit(
  transaction: ClinicTransaction,
  input: {
    action: string;
    afterValues: Record<string, string | null>;
    actorIdentityId: string;
    beforeValues: Record<string, string | null>;
    clinicId: string;
  },
) {
  return transaction.insert(configurationAuditEvents).values({
    action: input.action,
    actorIdentityId: input.actorIdentityId,
    afterValues: input.afterValues,
    beforeValues: input.beforeValues,
    clinicId: input.clinicId,
    entity: "whatsapp-operational-policies",
    entityId: input.clinicId,
  });
}
