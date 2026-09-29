import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { sanitizeWhatsAppOperationalText } from "~/domain/whatsapp-circuit-breaker";
import type { WhatsAppTemplateCoverageSource } from "~/domain/whatsapp-template-catalog";
import type {
  SupervisionSystemProblem,
  SupervisionWorkerKey,
  SupervisionWorkerQueue,
} from "~/domain/supervision-system";
import type {
  ClinicSupervisionBaseSnapshot,
  SupervisionSystemQueueData,
} from "~/server/application/supervision-dashboard";
import {
  inSuperadminRlsTransaction,
  type ClinicTransaction,
} from "~/server/db/clinic-context";
import {
  clinicInvitationDeliveries,
  clinicInvitations,
  clinicUsers,
  clinics,
  transactionalDeliveryAlerts,
  user as identities,
  whatsappCircuitBreakerAlerts,
  whatsappConnections,
  whatsappConnectionAlerts,
  whatsappCriticalTemplates,
  whatsappInboundAlerts,
  whatsappInboundMessages,
  whatsappInboundReplies,
  whatsappReadiness,
  whatsappWebhookEvents,
} from "~/server/db/schema";

type SupervisionInput = { actorIdentityId: string };

export const drizzleSupervisionDashboardStore = {
  async readClinic(input: SupervisionInput & { clinicId: string }) {
    return inSuperadminRlsTransaction(
      input.actorIdentityId,
      async (transaction): Promise<ClinicSupervisionBaseSnapshot | null> => {
        const clinic = await transaction.query.clinics.findFirst({
          columns: {
            id: true,
            isSynthetic: true,
            name: true,
            subscriptionStatus: true,
          },
          where: eq(clinics.id, input.clinicId),
        });
        if (clinic === undefined) return null;

        await setClinicContext(
          transaction,
          clinic.id,
          clinic.subscriptionStatus,
        );
        const now = new Date();
        const [owner, invitation] = await Promise.all([
          transaction
            .select({ name: identities.name })
            .from(clinicUsers)
            .innerJoin(identities, eq(clinicUsers.identityId, identities.id))
            .where(
              and(
                eq(clinicUsers.clinicId, clinic.id),
                eq(clinicUsers.role, "owner"),
                eq(clinicUsers.active, true),
              ),
            )
            .limit(1),
          transaction.query.clinicInvitations.findFirst({
            columns: {
              consumedAt: true,
              deliveryLeaseExpiresAt: true,
              expiresAt: true,
              id: true,
              recipientName: true,
            },
            where: and(
              eq(clinicInvitations.clinicId, clinic.id),
              eq(clinicInvitations.role, "owner"),
            ),
          }),
        ]);
        const latestDelivery = invitation
          ? await transaction.query.clinicInvitationDeliveries.findFirst({
              columns: { result: true },
              orderBy: [
                desc(clinicInvitationDeliveries.occurredAt),
                desc(clinicInvitationDeliveries.id),
              ],
              where: and(
                eq(clinicInvitationDeliveries.clinicId, clinic.id),
                eq(clinicInvitationDeliveries.invitationId, invitation.id),
              ),
            })
          : undefined;
        const ownerIsActive = owner.length > 0;
        const invitationIsPending =
          invitation?.consumedAt === null && invitation.expiresAt > now;
        const deliveryIsLeased =
          invitation?.deliveryLeaseExpiresAt !== null &&
          invitation?.deliveryLeaseExpiresAt !== undefined &&
          invitation.deliveryLeaseExpiresAt > now;

        return {
          clinic,
          owner: {
            access: ownerIsActive
              ? "ready"
              : invitationIsPending
                ? "pending"
                : "blocked",
            invitationCanRetry:
              !ownerIsActive &&
              invitation?.consumedAt === null &&
              !deliveryIsLeased &&
              (invitation.expiresAt <= now ||
                latestDelivery?.result !== "succeeded"),
            invitationDelivery: latestDelivery?.result ?? null,
            name: owner[0]?.name ?? invitation?.recipientName ?? null,
          },
        };
      },
    );
  },

  async readTemplateCoverage(input: SupervisionInput) {
    return inSuperadminRlsTransaction(
      input.actorIdentityId,
      async (transaction): Promise<WhatsAppTemplateCoverageSource[]> => {
        const wabas = await transaction
          .select({
            businessAccountId: whatsappConnections.businessAccountId,
            clinicId: clinics.id,
            clinicName: clinics.name,
            metadata: whatsappConnections.metadata,
          })
          .from(whatsappConnections)
          .innerJoin(clinics, eq(whatsappConnections.clinicId, clinics.id))
          .where(isNotNull(whatsappConnections.businessAccountId));
        if (wabas.length === 0) return [];

        const clinicIds = wabas.map(({ clinicId }) => clinicId);
        const templates = await transaction
          .select({
            catalogVersion: whatsappCriticalTemplates.catalogVersion,
            clinicId: whatsappCriticalTemplates.clinicId,
            kind: whatsappCriticalTemplates.kind,
            provisioningEventId: whatsappCriticalTemplates.provisioningEventId,
            provisioningStatus: whatsappCriticalTemplates.provisioningStatus,
            rejectionReason: whatsappCriticalTemplates.rejectionReason,
            providerTemplateId: whatsappCriticalTemplates.providerTemplateId,
            status: whatsappCriticalTemplates.status,
            syncedAt: whatsappCriticalTemplates.syncedAt,
          })
          .from(whatsappCriticalTemplates)
          .where(inArray(whatsappCriticalTemplates.clinicId, clinicIds));

        return wabas.flatMap((waba) => {
          if (waba.businessAccountId === null) return [];
          const provisioningEventId = waba.metadata.provisioningEventId ?? null;
          return [
            {
              businessAccountId: waba.businessAccountId,
              clinicId: waba.clinicId,
              clinicName: waba.clinicName,
              provisioningEventId,
              templates: templates
                .filter((template) => template.clinicId === waba.clinicId)
                .map(({ clinicId: _clinicId, ...template }) => template),
            },
          ];
        });
      },
    );
  },

  async readSystemQueues(
    input: SupervisionInput,
  ): Promise<SupervisionSystemQueueData> {
    return inSuperadminRlsTransaction(
      input.actorIdentityId,
      async (transaction) => {
        const [webhooks, inbound, provisioning, outbound, appointments] =
          await Promise.all([
            transaction
              .select({
                pending: sql<number>`count(*) filter (where ${whatsappWebhookEvents.status} = 'pending')::int`,
                processing: sql<number>`count(*) filter (where ${whatsappWebhookEvents.status} = 'processing')::int`,
                attention: sql<number>`count(*) filter (where ${whatsappWebhookEvents.status} = 'rejected')::int`,
              })
              .from(whatsappWebhookEvents),
            transaction
              .select({
                pending: sql<number>`count(*) filter (where ${whatsappInboundMessages.status} = 'pending')::int`,
                processing: sql<number>`count(*) filter (where ${whatsappInboundMessages.status} = 'processing')::int`,
                attention: sql<number>`count(*) filter (where ${whatsappInboundMessages.status} in ('rejected', 'conflict'))::int`,
              })
              .from(whatsappInboundMessages),
            transaction
              .select({
                pending: sql<number>`count(*) filter (where ${whatsappReadiness.reconciliationStatus} = 'pending')::int`,
                processing: sql<number>`count(*) filter (where ${whatsappReadiness.reconciliationStatus} = 'processing')::int`,
                attention: sql<number>`count(*) filter (where ${whatsappReadiness.reconciliationStatus} = 'blocked')::int`,
              })
              .from(whatsappReadiness),
            transaction
              .select({
                pending: sql<number>`count(*) filter (where ${whatsappInboundReplies.status} = 'pending')::int`,
                processing: sql<number>`count(*) filter (where ${whatsappInboundReplies.status} = 'processing')::int`,
                attention: sql<number>`count(*) filter (where ${whatsappInboundReplies.status} = 'failed')::int`,
              })
              .from(whatsappInboundReplies),
            readAppointmentDeliveryQueue(transaction),
          ]);
        const workers: Record<SupervisionWorkerKey, SupervisionWorkerQueue> = {
          appointments,
          inbound: inbound[0] ?? emptyQueue(),
          outbound: outbound[0] ?? emptyQueue(),
          provisioning: provisioning[0] ?? emptyQueue(),
          webhooks: webhooks[0] ?? emptyQueue(),
        };
        const problems = await readGlobalProblems(transaction);

        return { globalProblems: problems, workers };
      },
    );
  },
};

async function readAppointmentDeliveryQueue(transaction: ClinicTransaction) {
  const result = await transaction.execute(
    sql`select * from public.apolo_supervision_delivery_queue_status()`,
  );
  const row = result[0] as
    { pending: number; processing: number; attention: number } | undefined;
  return row ?? emptyQueue();
}

async function readGlobalProblems(
  transaction: ClinicTransaction,
): Promise<SupervisionSystemProblem[]> {
  const [
    connectionProblems,
    circuitProblems,
    inboundProblems,
    blockedReadiness,
    deliveryProblems,
  ] = await Promise.all([
    transaction
      .select({
        clinicId: clinics.id,
        clinicName: clinics.name,
        createdAt: whatsappConnectionAlerts.createdAt,
        id: whatsappConnectionAlerts.id,
        gateCode: whatsappConnectionAlerts.gateCode,
        nextAction: whatsappConnectionAlerts.nextAction,
        reason: whatsappConnectionAlerts.reason,
        lastSeenAt: whatsappConnectionAlerts.updatedAt,
        resourceReference: whatsappConnectionAlerts.provisioningEventId,
      })
      .from(whatsappConnectionAlerts)
      .innerJoin(clinics, eq(whatsappConnectionAlerts.clinicId, clinics.id))
      .where(eq(whatsappConnectionAlerts.status, "open"))
      .orderBy(desc(whatsappConnectionAlerts.updatedAt))
      .limit(30),
    transaction
      .select({
        clinicId: clinics.id,
        clinicName: clinics.name,
        createdAt: whatsappCircuitBreakerAlerts.openedAt,
        id: whatsappCircuitBreakerAlerts.clinicId,
        cause: whatsappCircuitBreakerAlerts.cause,
        nextAction: whatsappCircuitBreakerAlerts.nextAction,
        reason: whatsappCircuitBreakerAlerts.reason,
        lastSeenAt: whatsappCircuitBreakerAlerts.updatedAt,
      })
      .from(whatsappCircuitBreakerAlerts)
      .innerJoin(clinics, eq(whatsappCircuitBreakerAlerts.clinicId, clinics.id))
      .where(eq(whatsappCircuitBreakerAlerts.status, "open"))
      .orderBy(desc(whatsappCircuitBreakerAlerts.updatedAt))
      .limit(30),
    transaction
      .select({
        createdAt: whatsappInboundAlerts.createdAt,
        id: whatsappInboundAlerts.id,
        nextAction: whatsappInboundAlerts.nextAction,
        phoneNumberId: whatsappInboundAlerts.phoneNumberId,
        reason: whatsappInboundAlerts.reason,
        lastSeenAt: whatsappInboundAlerts.updatedAt,
      })
      .from(whatsappInboundAlerts)
      .where(eq(whatsappInboundAlerts.status, "open"))
      .orderBy(desc(whatsappInboundAlerts.updatedAt))
      .limit(30),
    transaction
      .select({
        clinicId: clinics.id,
        clinicName: clinics.name,
        createdAt: whatsappReadiness.updatedAt,
        id: whatsappReadiness.clinicId,
        nextAction: whatsappReadiness.nextAction,
        reason: whatsappReadiness.reconciliationLastError,
        lastSeenAt: whatsappReadiness.updatedAt,
      })
      .from(whatsappReadiness)
      .innerJoin(clinics, eq(whatsappReadiness.clinicId, clinics.id))
      .where(eq(whatsappReadiness.reconciliationStatus, "blocked"))
      .orderBy(desc(whatsappReadiness.updatedAt))
      .limit(30),
    transaction
      .select({
        clinicId: clinics.id,
        clinicName: clinics.name,
        createdAt: transactionalDeliveryAlerts.createdAt,
        id: transactionalDeliveryAlerts.id,
        resourceReference: transactionalDeliveryAlerts.deliveryId,
      })
      .from(transactionalDeliveryAlerts)
      .innerJoin(clinics, eq(transactionalDeliveryAlerts.clinicId, clinics.id))
      .where(isNull(transactionalDeliveryAlerts.resolvedAt))
      .orderBy(desc(transactionalDeliveryAlerts.createdAt))
      .limit(30),
  ]);

  return [
    ...connectionProblems.map((problem) => ({
      ...problem,
      area: "Preparación de WhatsApp",
      causeKey: problem.gateCode,
      lastSeenAt: problem.lastSeenAt,
      reason: sanitizeWhatsAppOperationalText(problem.reason),
      resourceKey: "whatsapp-connection",
      resourceLabel: "Conexión de WhatsApp",
      severity: "high" as const,
      source: "connection" as const,
    })),
    ...circuitProblems.map((problem) => ({
      ...problem,
      area: "Capacidad de WhatsApp",
      causeKey: problem.cause,
      lastSeenAt: problem.lastSeenAt,
      reason: sanitizeWhatsAppOperationalText(problem.reason),
      resourceKey: "whatsapp-capacity",
      resourceLabel: "Capacidad de mensajería",
      severity: "critical" as const,
      source: "circuit-breaker" as const,
    })),
    ...inboundProblems.map((problem) => {
      const reason = sanitizeWhatsAppOperationalText(problem.reason);
      return {
        ...problem,
        area: "Recepción de WhatsApp",
        clinicId: null,
        clinicName: null,
        causeKey: normalizedProblemKey(reason),
        lastSeenAt: problem.lastSeenAt,
        reason,
        resourceKey: `whatsapp-number:${problem.phoneNumberId}`,
        resourceLabel: `Número de WhatsApp · ${problem.phoneNumberId}`,
        resourceReference: problem.phoneNumberId,
        severity: "medium" as const,
        source: "inbound" as const,
      };
    }),
    ...blockedReadiness.map((problem) => ({
      ...problem,
      area: "Reconciliación de WhatsApp",
      causeKey: "blocked-reconciliation",
      nextAction:
        problem.nextAction ?? "Revisar la reconciliación de WhatsApp.",
      reason: sanitizeWhatsAppOperationalText(
        problem.reason ?? "La reconciliación requiere intervención.",
      ),
      resourceKey: "whatsapp-reconciliation",
      resourceLabel: "Reconciliación de WhatsApp",
      severity: "high" as const,
      source: "readiness" as const,
    })),
    ...deliveryProblems.map((problem) => ({
      ...problem,
      area: "Entregas de citas",
      causeKey: "failed-transactional-delivery",
      nextAction: "Resolver la alerta en la Clínica.",
      reason: "Una entrega transaccional necesita resolución humana.",
      lastSeenAt: problem.createdAt,
      resourceKey: "transactional-deliveries",
      resourceLabel: "Entregas transaccionales",
      severity: "high" as const,
      source: "delivery" as const,
    })),
  ]
    .sort((left, right) => right.createdAt.valueOf() - left.createdAt.valueOf())
    .slice(0, 60);
}

function normalizedProblemKey(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

async function setClinicContext(
  transaction: ClinicTransaction,
  clinicId: string,
  subscriptionStatus: "active" | "suspended",
) {
  await transaction.execute(
    sql`select set_config('app.clinic_id', ${clinicId}, true)`,
  );
  await transaction.execute(
    sql`select set_config('app.subscription_status', ${subscriptionStatus}, true)`,
  );
}

function emptyQueue(): SupervisionWorkerQueue {
  return { attention: 0, pending: 0, processing: 0 };
}
