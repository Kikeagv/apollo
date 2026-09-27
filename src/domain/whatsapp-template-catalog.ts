import {
  whatsappCriticalTemplateCatalog,
  type WhatsAppCriticalTemplateKind,
  type WhatsAppTemplateDefinition,
  type WhatsAppTemplateProvisioningStatus,
  type WhatsAppTemplateStatus,
} from "./whatsapp-readiness";

export type WhatsAppTemplateCoverageSource = {
  clinicId: string;
  clinicName: string;
  businessAccountId: string;
  provisioningEventId: string | null;
  templates: Array<{
    catalogVersion: number;
    kind: WhatsAppCriticalTemplateKind;
    provisioningEventId: string | null;
    provisioningStatus: WhatsAppTemplateProvisioningStatus;
    rejectionReason: string | null;
    providerTemplateId: string | null;
    status: WhatsAppTemplateStatus;
    syncedAt: Date | null;
  }>;
};

export type WhatsAppTemplateCoverageStatus =
  "approved" | "disabled" | "missing" | "outdated" | "pending" | "rejected";

export type WhatsAppTemplateCatalogCoverage = {
  definitions: WhatsAppTemplateDefinition[];
  wabas: Array<{
    clinicId: string;
    clinicName: string;
    businessAccountId: string;
    templates: Array<{
      category: WhatsAppTemplateDefinition["category"];
      content: string;
      examples: Record<string, string>;
      kind: WhatsAppCriticalTemplateKind;
      locale: string;
      name: string;
      provisioningStatus: WhatsAppTemplateCoverageStatus;
      providerTemplateId: string | null;
      rejectionReason: string | null;
      status: WhatsAppTemplateCoverageStatus;
      syncedAt: Date | null;
      variables: string[];
      version: number;
    }>;
  }>;
};

/** Une la definición común con el estado guardado de cada WABA vigente. */
export function buildWhatsAppTemplateCatalogCoverage(
  sources: WhatsAppTemplateCoverageSource[],
): WhatsAppTemplateCatalogCoverage {
  return {
    definitions: whatsappCriticalTemplateCatalog.map((definition) => ({
      ...definition,
      examples: { ...definition.examples },
      variables: [...definition.variables],
    })),
    wabas: sources.map((source) => ({
      businessAccountId: source.businessAccountId,
      clinicId: source.clinicId,
      clinicName: source.clinicName,
      templates: whatsappCriticalTemplateCatalog.map((definition) => {
        const persisted = source.templates.find(
          (template) => template.kind === definition.kind,
        );
        const current =
          persisted?.catalogVersion === definition.version &&
          source.provisioningEventId !== null &&
          persisted.provisioningEventId === source.provisioningEventId;
        const status = templateCoverageStatus(persisted, current);

        return {
          category: definition.category,
          content: definition.content,
          examples: { ...definition.examples },
          kind: definition.kind,
          locale: definition.locale,
          name: definition.name,
          provisioningStatus: status,
          providerTemplateId: persisted?.providerTemplateId ?? null,
          rejectionReason:
            current && status === "rejected" ? persisted.rejectionReason : null,
          status,
          syncedAt: current ? persisted.syncedAt : null,
          variables: [...definition.variables],
          version: definition.version,
        };
      }),
    })),
  };
}

function templateCoverageStatus(
  persisted: WhatsAppTemplateCoverageSource["templates"][number] | undefined,
  current: boolean,
): WhatsAppTemplateCoverageStatus {
  if (persisted === undefined) return "missing";
  if (!current) return "outdated";
  if (
    persisted.status === "REJECTED" ||
    persisted.provisioningStatus === "rejected"
  ) {
    return "rejected";
  }
  if (persisted.status === "DISABLED") return "disabled";
  if (
    persisted.status === "APPROVED" &&
    persisted.provisioningStatus === "approved"
  ) {
    return "approved";
  }
  return "pending";
}
