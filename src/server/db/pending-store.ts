import { and, eq, isNotNull, isNull } from "drizzle-orm";

import type { PendingCase, PendingStatus } from "~/domain/pending";
import type {
  PendingCaseReader,
  PendingCaseResolver,
} from "~/server/application/pending";
import {
  drizzleAppointmentSelfManagementEscalationResolver,
  drizzleConversationEscalationResolver,
} from "~/server/db/simulated-whatsapp-booking-store";
import { drizzleTransactionalDeliveryAlertResolver } from "~/server/db/transactional-delivery-store";
import { inClinicTransaction } from "~/server/db/clinic-context";
import type { db } from "~/server/db";
import {
  appointmentSelfManagementEscalations,
  contacts,
  conversationEscalations,
  transactionalDeliveries,
  transactionalDeliveryAlerts,
} from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Read model unificado bajo una sola transacción con contexto de Clínica y rol. */
export const drizzlePendingStore: PendingCaseReader = {
  async listPendingCases(input) {
    return inClinicTransaction(input, async (transaction) => {
      const [conversations, appointments, deliveries] = await Promise.all([
        listConversationCases(transaction, input.clinicId, input.status),
        listAppointmentCases(transaction, input.clinicId, input.status),
        listDeliveryCases(transaction, input.clinicId, input.status),
      ]);
      return [...conversations, ...appointments, ...deliveries];
    });
  },
};

/** Resoluciones específicas que conservan el caso de uso y la auditoría de cada fuente. */
export const drizzlePendingResolver: PendingCaseResolver = {
  resolveAppointmentSelfManagementEscalation: (input) =>
    drizzleAppointmentSelfManagementEscalationResolver.resolveSelfManagementEscalation(
      input,
    ),
  resolveConversationEscalation: (input) =>
    drizzleConversationEscalationResolver.resolveConversationEscalation(input),
  resolveTransactionalDeliveryAlert: (input) =>
    drizzleTransactionalDeliveryAlertResolver.resolveTransactionalDeliveryAlert(
      input,
    ),
};

async function listConversationCases(
  transaction: ClinicTransaction,
  clinicId: string,
  status: PendingStatus,
): Promise<PendingCase[]> {
  const rows = await transaction
    .select({
      contactId: contacts.id,
      contactName: contacts.name,
      createdAt: conversationEscalations.createdAt,
      id: conversationEscalations.id,
      priority: conversationEscalations.priority,
      resolvedAt: conversationEscalations.resolvedAt,
      trigger: conversationEscalations.trigger,
    })
    .from(conversationEscalations)
    .innerJoin(
      contacts,
      and(
        eq(conversationEscalations.clinicId, contacts.clinicId),
        eq(conversationEscalations.contactId, contacts.id),
      ),
    )
    .where(
      and(
        eq(conversationEscalations.clinicId, clinicId),
        status === "open"
          ? isNull(conversationEscalations.resolvedAt)
          : isNotNull(conversationEscalations.resolvedAt),
      ),
    );

  return rows.map((row) => ({
    category: "conversation" as const,
    contact: { id: row.contactId, name: row.contactName },
    createdAt: row.createdAt,
    id: row.id,
    priority: row.priority,
    resolvedAt: row.resolvedAt,
    status: row.resolvedAt === null ? "open" : "resolved",
    trigger: row.trigger,
  }));
}

async function listAppointmentCases(
  transaction: ClinicTransaction,
  clinicId: string,
  status: PendingStatus,
): Promise<PendingCase[]> {
  const rows = await transaction
    .select({
      action: appointmentSelfManagementEscalations.action,
      appointmentId: appointmentSelfManagementEscalations.appointmentId,
      contactId: contacts.id,
      contactName: contacts.name,
      createdAt: appointmentSelfManagementEscalations.createdAt,
      id: appointmentSelfManagementEscalations.id,
      priority: appointmentSelfManagementEscalations.priority,
      requestedStartsAt: appointmentSelfManagementEscalations.requestedStartsAt,
      resolvedAt: appointmentSelfManagementEscalations.resolvedAt,
    })
    .from(appointmentSelfManagementEscalations)
    .innerJoin(
      contacts,
      and(
        eq(appointmentSelfManagementEscalations.clinicId, contacts.clinicId),
        eq(appointmentSelfManagementEscalations.contactId, contacts.id),
      ),
    )
    .where(
      and(
        eq(appointmentSelfManagementEscalations.clinicId, clinicId),
        status === "open"
          ? isNull(appointmentSelfManagementEscalations.resolvedAt)
          : isNotNull(appointmentSelfManagementEscalations.resolvedAt),
      ),
    );

  return rows.map((row) => ({
    action: row.action,
    appointmentId: row.appointmentId,
    category: "appointment" as const,
    contact: { id: row.contactId, name: row.contactName },
    createdAt: row.createdAt,
    id: row.id,
    priority: row.priority,
    requestedStartsAt: row.requestedStartsAt,
    resolvedAt: row.resolvedAt,
    status: row.resolvedAt === null ? "open" : "resolved",
  }));
}

async function listDeliveryCases(
  transaction: ClinicTransaction,
  clinicId: string,
  status: PendingStatus,
): Promise<PendingCase[]> {
  const rows = await transaction
    .select({
      attempts: transactionalDeliveries.attempts,
      createdAt: transactionalDeliveryAlerts.createdAt,
      deliveryIdempotencyKey: transactionalDeliveries.idempotencyKey,
      deliveryKind: transactionalDeliveries.kind,
      id: transactionalDeliveryAlerts.id,
      lastError: transactionalDeliveries.lastError,
      priority: transactionalDeliveryAlerts.priority,
      resolvedAt: transactionalDeliveryAlerts.resolvedAt,
    })
    .from(transactionalDeliveryAlerts)
    .innerJoin(
      transactionalDeliveries,
      and(
        eq(
          transactionalDeliveryAlerts.clinicId,
          transactionalDeliveries.clinicId,
        ),
        eq(transactionalDeliveryAlerts.deliveryId, transactionalDeliveries.id),
      ),
    )
    .where(
      and(
        eq(transactionalDeliveryAlerts.clinicId, clinicId),
        status === "open"
          ? isNull(transactionalDeliveryAlerts.resolvedAt)
          : isNotNull(transactionalDeliveryAlerts.resolvedAt),
      ),
    );

  return rows.map((row) => ({
    category: "delivery" as const,
    createdAt: row.createdAt,
    delivery: {
      attempts: row.attempts,
      idempotencyKey: row.deliveryIdempotencyKey,
      kind: row.deliveryKind,
      lastError: row.lastError,
    },
    id: row.id,
    priority: row.priority,
    resolvedAt: row.resolvedAt,
    status: row.resolvedAt === null ? "open" : "resolved",
  }));
}
