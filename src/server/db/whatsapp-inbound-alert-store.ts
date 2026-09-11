import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type {
  WhatsAppInboundAlertStatus,
  WhatsAppInboundOperationalAlert,
} from "~/domain/whatsapp-inbound-alert";
import { inSuperadminTransaction } from "~/server/db/clinic-context";
import {
  whatsappInboundAlerts,
  whatsappInboundMessages,
} from "~/server/db/schema";

/** Lee alertas globales de recepción sin conceder contexto clínico. */
export async function listWhatsAppInboundOperationalAlerts(input: {
  identityId: string;
  status?: WhatsAppInboundAlertStatus;
}): Promise<WhatsAppInboundOperationalAlert[]> {
  return inSuperadminTransaction(input.identityId, async (transaction) => {
    const rows = await transaction
      .select()
      .from(whatsappInboundAlerts)
      .where(
        input.status === undefined
          ? isNull(whatsappInboundAlerts.resolvedAt)
          : eq(whatsappInboundAlerts.status, input.status),
      )
      .orderBy(desc(whatsappInboundAlerts.createdAt));
    return rows.map((row) => ({
      connectionReference: row.phoneNumberId,
      createdAt: row.createdAt,
      customerReference: row.customerId,
      id: row.id,
      inboundMessageId: row.inboundMessageId,
      nextAction: row.nextAction,
      reason: row.reason,
      resolvedByIdentityId: row.resolvedByIdentityId,
      resolvedAt: row.resolvedAt,
      status: row.status,
      updatedAt: row.updatedAt,
    }));
  });
}

/** Reencola un evento rechazado después de que Apolo corrija su asignación. */
export async function resolveWhatsAppInboundOperationalAlert(input: {
  alertId: string;
  identityId: string;
  now: Date;
}) {
  return inSuperadminTransaction(input.identityId, async (transaction) => {
    const [alert] = await transaction
      .select({
        inboundMessageId: whatsappInboundAlerts.inboundMessageId,
      })
      .from(whatsappInboundAlerts)
      .where(
        and(
          eq(whatsappInboundAlerts.id, input.alertId),
          eq(whatsappInboundAlerts.status, "open"),
        ),
      )
      .for("update");
    if (alert === undefined) return false;

    const [message] = await transaction
      .select({ status: whatsappInboundMessages.status })
      .from(whatsappInboundMessages)
      .where(eq(whatsappInboundMessages.id, alert.inboundMessageId))
      .for("update");
    if (message?.status !== "rejected") return false;

    await transaction.execute(
      sql`select set_config('app.whatsapp_inbound_worker', 'true', true)`,
    );
    const [requeued] = await transaction
      .update(whatsappInboundMessages)
      .set({
        assistantResponseText: null,
        lastError: null,
        leaseExpiresAt: null,
        leaseToken: null,
        nextAttemptAt: input.now,
        processedAt: null,
        status: "pending",
      })
      .where(eq(whatsappInboundMessages.id, alert.inboundMessageId))
      .returning({ id: whatsappInboundMessages.id });
    if (requeued === undefined) return false;
    const [resolved] = await transaction
      .update(whatsappInboundAlerts)
      .set({
        resolvedAt: input.now,
        resolvedByIdentityId: input.identityId,
        status: "resolved",
        updatedAt: input.now,
      })
      .where(
        and(
          eq(whatsappInboundAlerts.id, input.alertId),
          eq(whatsappInboundAlerts.status, "open"),
        ),
      )
      .returning({ id: whatsappInboundAlerts.id });
    return resolved !== undefined;
  });
}
