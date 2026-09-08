import { and, eq } from "drizzle-orm";

import {
  isWhatsAppConnectionReady,
  publicWhatsAppConnectionMetadata,
} from "~/domain/whatsapp-connection";
import {
  evaluateWhatsAppReadiness,
  type WhatsAppReadinessInput,
} from "~/domain/whatsapp-readiness";
import type { WhatsAppProviderId } from "~/domain/whatsapp-runtime";
import type { WhatsAppConnectionReader } from "~/server/application/whatsapp-connections";
import { WhatsAppConnectionRequiredError } from "~/server/application/whatsapp-provider";
import {
  inClinicTransaction,
  inWhatsAppProviderTransaction,
} from "~/server/db/clinic-context";
import {
  clinicUsers,
  whatsappConnections,
  whatsappBilling,
  whatsappCriticalTemplates,
  whatsappReadiness,
} from "~/server/db/schema";

/** Lee la conexión sin sacar al operador del alcance RLS de su Clínica. */
export const drizzleWhatsAppConnectionReader: WhatsAppConnectionReader = {
  async read(input) {
    return inClinicTransaction(input, async (transaction) => {
      const membership = await transaction.query.clinicUsers.findFirst({
        columns: { id: true },
        where: and(
          eq(clinicUsers.clinicId, input.clinicId),
          eq(clinicUsers.identityId, input.identityId),
          eq(clinicUsers.active, true),
          eq(clinicUsers.role, "owner"),
        ),
      });
      if (membership === undefined) return undefined;

      const connection = await transaction.query.whatsappConnections.findFirst({
        where: eq(whatsappConnections.clinicId, input.clinicId),
      });
      return connection === undefined
        ? undefined
        : {
            ...connection,
            metadata: publicWhatsAppConnectionMetadata(connection.metadata),
          };
    });
  },
};

/** Verifica el estado y proveedor antes de cualquier envío externo. */
export async function requireWhatsAppConnectionReady(input: {
  clinicId: string;
  provider: WhatsAppProviderId;
}) {
  const connection = await inWhatsAppProviderTransaction(
    input.clinicId,
    async (transaction) => {
      const connection = await transaction.query.whatsappConnections.findFirst({
        where: and(
          eq(whatsappConnections.clinicId, input.clinicId),
          eq(whatsappConnections.provider, input.provider),
        ),
      });
      if (connection === undefined) return undefined;
      if (input.provider === "kapso") {
        const [readiness, billing, templates] = await Promise.all([
          transaction.query.whatsappReadiness.findFirst({
            where: eq(whatsappReadiness.clinicId, input.clinicId),
          }),
          transaction.query.whatsappBilling.findFirst({
            where: eq(whatsappBilling.clinicId, input.clinicId),
          }),
          transaction.query.whatsappCriticalTemplates.findMany({
            where: eq(whatsappCriticalTemplates.clinicId, input.clinicId),
          }),
        ]);
        const billingStatus =
          readiness?.billingSyncStatus === "failed" ||
          billing?.status === "failed"
            ? "failed"
            : readiness?.billingSyncStatus === "ready" &&
                billing?.status === "ready"
              ? "ready"
              : "pending";
        if (readiness === undefined) return undefined;
        const readinessResult = evaluateWhatsAppReadiness({
          billing: {
            alertThresholdCents: billing?.alertThresholdCents ?? null,
            chargesSeparated: billing?.chargesSeparated ?? false,
            consumedCents: billing?.consumedCents ?? 0,
            creditCents: billing?.creditCents ?? 0,
            metaChargesCents: billing?.metaChargesCents ?? null,
            mode: billing?.mode ?? "unknown",
            platformChargesCents: billing?.platformChargesCents ?? null,
            status: billingStatus,
          },
          connection: {
            businessAccountId: connection.businessAccountId,
            connectionType: connection.connectionType,
            phoneNumberId: connection.phoneNumberId,
            provider: connection.provider,
            status: connection.status,
          },
          e2e: {
            evidence: readiness.e2eEvidence,
            evidenceScope: readiness.e2eEvidenceScope,
            lastTestAt: readiness.e2eLastTestAt,
            status: readiness.e2eStatus,
          },
          number: {
            environment: readiness.numberEnvironment,
            health: readiness.numberHealth,
            healthCheckedAt: readiness.numberHealthCheckedAt,
          },
          now: new Date(),
          templatesSync: { status: readiness.templatesSyncStatus },
          templates: templates
            .filter(
              (template) =>
                template.projectId === readiness.projectId &&
                template.provisioningEventId === readiness.provisioningEventId,
            )
            .map((template) => ({
              category: template.category,
              kind: template.kind,
              locale: template.locale,
              name: template.name,
              providerTemplateId: template.providerTemplateId,
              rejectionReason: template.rejectionReason,
              status: template.status,
              syncedAt: template.syncedAt,
              variables: template.variables,
            })),
          webhooks: {
            phoneNumber: { status: readiness.phoneNumberWebhookStatus },
            project: { status: readiness.projectWebhookStatus },
          },
        } satisfies WhatsAppReadinessInput);
        if (
          readinessResult?.status !== "ready" ||
          readiness.projectWebhookId === null ||
          readiness.phoneNumberWebhookId === null ||
          connection.metadata.webhookStatus !== "ready" ||
          connection.metadata.health !== "healthy" ||
          connection.phoneNumberId == null ||
          connection.businessAccountId == null ||
          readiness.phoneNumberId !== connection.phoneNumberId ||
          readiness.businessAccountId !==
            (connection.businessAccountId ?? null) ||
          readiness.projectId !== (connection.metadata.projectId ?? null) ||
          readiness.provisioningEventId !==
            (connection.metadata.provisioningEventId ?? null)
        ) {
          return undefined;
        }
      }
      return connection;
    },
  );
  if (connection === undefined || !isWhatsAppConnectionReady(connection)) {
    throw new WhatsAppConnectionRequiredError();
  }
  return connection;
}
