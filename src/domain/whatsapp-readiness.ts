import type {
  WhatsAppConnectionStatus,
  WhatsAppConnectionType,
} from "./whatsapp-connection";
import type { WhatsAppProviderId } from "./whatsapp-runtime";

export const whatsappCriticalTemplateKinds = [
  "confirmation",
  "reminder",
  "cancellation",
  "reschedule",
] as const;

export type WhatsAppCriticalTemplateKind =
  (typeof whatsappCriticalTemplateKinds)[number];

export const whatsappTemplateStatuses = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "DISABLED",
] as const;

export type WhatsAppTemplateStatus = (typeof whatsappTemplateStatuses)[number];

export const whatsappTemplateCategories = [
  "AUTHENTICATION",
  "MARKETING",
  "UTILITY",
] as const;

export type WhatsAppTemplateCategory =
  (typeof whatsappTemplateCategories)[number];

export const whatsappTemplateProvisioningStatuses = [
  "missing",
  "submitted",
  "in_review",
  "approved",
  "rejected",
] as const;

export type WhatsAppTemplateProvisioningStatus =
  (typeof whatsappTemplateProvisioningStatuses)[number];

export const whatsappNumberHealthStatuses = [
  "healthy",
  "degraded",
  "unhealthy",
  "error",
  "unknown",
] as const;

export type WhatsAppNumberHealth =
  (typeof whatsappNumberHealthStatuses)[number];

export const whatsappE2EEvidenceScopes = [
  "message-roundtrip",
  "webhook-preflight",
] as const;

export type WhatsAppE2EEvidenceScope =
  (typeof whatsappE2EEvidenceScopes)[number];

/** La salud remota deja de ser evidencia suficiente después de este intervalo. */
export const whatsappNumberHealthMaxAgeMs = 5 * 60_000;

const appointmentTemplateVariables = [
  "patient_name",
  "clinic_name",
  "appointment_date",
  "appointment_time",
  "doctor_name",
] as const;

/** Catálogo central: la Clínica no edita el contenido de estas plantillas. */
export const whatsappCriticalTemplateCatalog = [
  {
    kind: "confirmation",
    category: "UTILITY",
    content:
      "Hola {{patient_name}}, tu cita en {{clinic_name}} es el {{appointment_date}} a las {{appointment_time}} con {{doctor_name}}.",
    locale: "es",
    name: "appointment_confirmation",
    examples: {
      appointment_date: "25 de septiembre de 2026",
      appointment_time: "08:30",
      clinic_name: "Clínica Central",
      doctor_name: "Dra. Ana López",
      patient_name: "María Hernández",
    },
    version: 1,
    variables: appointmentTemplateVariables,
  },
  {
    kind: "reminder",
    category: "UTILITY",
    content:
      "Recordatorio: {{patient_name}}, tu cita en {{clinic_name}} es el {{appointment_date}} a las {{appointment_time}} con {{doctor_name}}.",
    locale: "es",
    name: "appointment_reminder",
    examples: {
      appointment_date: "25 de septiembre de 2026",
      appointment_time: "08:30",
      clinic_name: "Clínica Central",
      doctor_name: "Dra. Ana López",
      patient_name: "María Hernández",
    },
    version: 1,
    variables: appointmentTemplateVariables,
  },
  {
    kind: "cancellation",
    category: "UTILITY",
    content:
      "{{patient_name}}, tu cita en {{clinic_name}} del {{appointment_date}} a las {{appointment_time}} con {{doctor_name}} fue cancelada.",
    locale: "es",
    name: "appointment_cancellation",
    examples: {
      appointment_date: "25 de septiembre de 2026",
      appointment_time: "08:30",
      clinic_name: "Clínica Central",
      doctor_name: "Dra. Ana López",
      patient_name: "María Hernández",
    },
    version: 1,
    variables: appointmentTemplateVariables,
  },
  {
    kind: "reschedule",
    category: "UTILITY",
    content:
      "{{patient_name}}, tu cita en {{clinic_name}} fue reprogramada para el {{appointment_date}} a las {{appointment_time}} con {{doctor_name}}.",
    locale: "es",
    name: "appointment_reschedule",
    examples: {
      appointment_date: "25 de septiembre de 2026",
      appointment_time: "08:30",
      clinic_name: "Clínica Central",
      doctor_name: "Dra. Ana López",
      patient_name: "María Hernández",
    },
    version: 1,
    variables: appointmentTemplateVariables,
  },
] as const satisfies ReadonlyArray<{
  kind: WhatsAppCriticalTemplateKind;
  category: WhatsAppTemplateCategory;
  content: string;
  examples: Readonly<Record<string, string>>;
  locale: string;
  name: string;
  version: number;
  variables: readonly string[];
}>;

export type WhatsAppTemplateDefinition =
  (typeof whatsappCriticalTemplateCatalog)[number];

export type WhatsAppTemplateSnapshot = {
  category: WhatsAppTemplateCategory | null;
  catalogVersion?: number;
  content?: string;
  examples?: Record<string, string>;
  kind: WhatsAppCriticalTemplateKind;
  locale: string;
  name: string;
  providerTemplateId: string | null;
  provisioningStatus?: WhatsAppTemplateProvisioningStatus;
  rejectionReason: string | null;
  status: WhatsAppTemplateStatus;
  syncedAt: Date | null;
  variables: string[];
};

export type WhatsAppReadinessInput = {
  allowConnectionRecovery?: boolean;
  billing: WhatsAppBillingSnapshot;
  connection: {
    businessAccountId?: string | null;
    connectionType: WhatsAppConnectionType;
    phoneNumberId: string | null;
    provider: WhatsAppProviderId;
    status: WhatsAppConnectionStatus;
  };
  e2e: WhatsAppE2ESnapshot;
  number: {
    environment: "production" | "sandbox" | "unknown";
    health: WhatsAppNumberHealth;
    healthCheckedAt: Date | null;
  };
  now?: Date;
  templatesSync: {
    status: "ready" | "pending" | "failed";
  };
  templates: WhatsAppTemplateSnapshot[];
  webhooks: {
    phoneNumber: WhatsAppWebhookSnapshot;
    project: WhatsAppWebhookSnapshot;
  };
};

export type WhatsAppWebhookSnapshot = {
  status: "ready" | "pending" | "failed";
};

export type WhatsAppBillingSnapshot = {
  alertThresholdCents: number | null;
  chargesSeparated: boolean;
  consumedCents: number;
  creditCents: number;
  creditInFlightCents?: number;
  creditLimitCents?: number | null;
  creditReserveCents?: number | null;
  estimatedDailyConsumptionCents?: number;
  warningBalancePercent?: number;
  criticalBalancePercent?: number;
  warningAutonomyDays?: number;
  criticalAutonomyDays?: number;
  kapsoMonthlyQuota?: number | null;
  kapsoQuotaPeriod?: string | null;
  kapsoQuotaConsumed?: number;
  kapsoQuotaReserved?: number;
  kapsoQuotaInFlight?: number;
  metaChargesCents?: number | null;
  platformChargesCents?: number | null;
  mode: "partner_managed" | "customer_managed" | "unknown";
  status: "ready" | "pending" | "failed";
};

export type WhatsAppE2ESnapshot = {
  evidence: string | null;
  evidenceScope: WhatsAppE2EEvidenceScope | null;
  lastTestAt: Date | null;
  status: "passed" | "pending" | "failed";
};

export type WhatsAppReadinessGateCode =
  "number" | "webhooks" | "templates" | "billing" | "e2e";

export type WhatsAppReadinessGateStatus =
  "ready" | "pending" | "blocked" | "failed";

export type WhatsAppReadinessGate = {
  action: string;
  code: WhatsAppReadinessGateCode;
  message: string;
  status: WhatsAppReadinessGateStatus;
};

export type WhatsAppTechnicalReadinessStatus =
  "pending" | "ready" | "degraded" | "blocked";

export type WhatsAppReadinessResult = {
  gates: WhatsAppReadinessGate[];
  legalAuthorization: {
    allowed: false;
    message: string;
  };
  nextAction: string | null;
  status: WhatsAppTechnicalReadinessStatus;
  statusReason: string;
};

const legalAuthorization = {
  allowed: false as const,
  message:
    "El readiness técnico no autoriza datos reales; consentimiento y gates legales siguen siendo obligatorios.",
};

export function evaluateWhatsAppReadiness(
  input: WhatsAppReadinessInput,
): WhatsAppReadinessResult {
  const gates = [
    evaluateNumber(input),
    evaluateWebhooks(input),
    evaluateTemplates(input),
    evaluateBilling(input),
    evaluateE2E(input),
  ];
  const firstIncomplete = gates.find((gate) => gate.status !== "ready");
  const status = gates.some((gate) => gate.status === "blocked")
    ? "blocked"
    : gates.some((gate) => gate.status === "failed")
      ? "degraded"
      : gates.every((gate) => gate.status === "ready")
        ? "ready"
        : "pending";

  return {
    gates,
    legalAuthorization,
    nextAction: firstIncomplete?.action ?? null,
    status,
    statusReason:
      firstIncomplete?.message ?? "Todos los gates técnicos están correctos",
  };
}

function evaluateNumber(input: WhatsAppReadinessInput): WhatsAppReadinessGate {
  if (
    input.connection.status === "blocked" &&
    input.allowConnectionRecovery !== true
  ) {
    return gate(
      "number",
      "blocked",
      "La Conexión está bloqueada y requiere reactivación manual",
      "Reactivar manualmente la Conexión de WhatsApp",
    );
  }
  if (
    input.connection.status === "degraded" &&
    input.allowConnectionRecovery !== true
  ) {
    return gate(
      "number",
      "failed",
      "La Conexión está degradada y no puede enviar todavía",
      "Revisar la Conexión y reintentar sus gates",
    );
  }
  if (input.connection.provider !== "kapso") {
    return gate(
      "number",
      "blocked",
      "La Conexión no usa el adaptador Kapso requerido para producción",
      "Asociar la Conexión de WhatsApp con Kapso",
    );
  }
  if (input.connection.connectionType !== "coexistence") {
    return gate(
      "number",
      "blocked",
      "El número no está conectado en modo coexistence",
      "Completar el setup link en modo coexistence",
    );
  }
  if (input.connection.phoneNumberId == null) {
    return gate(
      "number",
      "pending",
      "Kapso todavía no confirmó el número de WhatsApp",
      "Esperar el evento de número creado de Kapso",
    );
  }
  if (input.connection.businessAccountId == null) {
    return gate(
      "number",
      "pending",
      "El WABA todavía no está asociado a la Conexión",
      "Esperar la asociación del Business Account de Kapso",
    );
  }
  if (input.number.environment === "sandbox") {
    return gate(
      "number",
      "blocked",
      "La sincronización de plantillas está deshabilitada para números sandbox",
      "Usar un número de producción para sincronizar plantillas",
    );
  }
  if (input.number.environment === "unknown") {
    return gate(
      "number",
      "pending",
      "No se pudo confirmar que el número sea de producción",
      "Confirmar el entorno productivo del número en Kapso",
    );
  }
  if (input.connection.status === "disconnected") {
    return gate(
      "number",
      "blocked",
      "Kapso desconectó el número de WhatsApp",
      "Reconectar WhatsApp desde Configuración",
    );
  }
  if (input.number.health === "unknown") {
    return gate(
      "number",
      "pending",
      "No se pudo verificar la salud operativa del número en Kapso",
      "Reintentar la comprobación de salud del número",
    );
  }
  if (input.number.health === "degraded") {
    return gate(
      "number",
      "failed",
      "Kapso reportó salud degradada en el número de WhatsApp",
      "Revisar la salud del número y reintentar readiness",
    );
  }
  if (input.number.health === "unhealthy" || input.number.health === "error") {
    return gate(
      "number",
      "blocked",
      `Kapso no permite mensajería porque la salud del número es ${input.number.health}`,
      "Resolver el bloqueo de salud en Kapso antes de reactivar la Conexión",
    );
  }
  if (
    input.number.health === "healthy" &&
    (input.number.healthCheckedAt === null ||
      (input.now !== undefined &&
        input.now.valueOf() - input.number.healthCheckedAt.valueOf() >
          whatsappNumberHealthMaxAgeMs))
  ) {
    return gate(
      "number",
      "pending",
      "La evidencia de salud del número expiró",
      "Revalidar la salud del número en Kapso",
    );
  }
  return gate("number", "ready", "Número y WABA asociados", "");
}

function evaluateWebhooks(
  input: WhatsAppReadinessInput,
): WhatsAppReadinessGate {
  const statuses = [
    input.webhooks.project.status,
    input.webhooks.phoneNumber.status,
  ];
  if (statuses.includes("failed")) {
    return gate(
      "webhooks",
      "failed",
      "Uno de los webhooks de Kapso falló",
      "Reintentar la provisión de webhooks",
    );
  }
  if (statuses.includes("pending")) {
    return gate(
      "webhooks",
      "pending",
      "Los webhooks de proyecto y número todavía no están confirmados",
      "Reintentar la provisión de webhooks",
    );
  }
  return gate("webhooks", "ready", "Webhooks de proyecto y número listos", "");
}

function evaluateTemplates(
  input: WhatsAppReadinessInput,
): WhatsAppReadinessGate {
  if (input.templatesSync.status === "failed") {
    return gate(
      "templates",
      "failed",
      "La última sincronización de plantillas falló",
      "Reintentar la sincronización de plantillas",
    );
  }
  if (input.templatesSync.status === "pending") {
    return gate(
      "templates",
      "pending",
      "Las plantillas críticas todavía no se han sincronizado",
      "Sincronizar las plantillas críticas",
    );
  }
  for (const definition of whatsappCriticalTemplateCatalog) {
    const template = input.templates.find(
      (candidate) => candidate.kind === definition.kind,
    );
    if (template === undefined) {
      return gate(
        "templates",
        "pending",
        `Falta la plantilla crítica ${definition.name}`,
        "Sincronizar las plantillas críticas",
      );
    }
    if (template.provisioningStatus === "missing") {
      return gate(
        "templates",
        "pending",
        `La plantilla ${definition.name} todavía no existe en el WABA`,
        "Sincronizar las plantillas críticas",
      );
    }
    if (template.provisioningStatus === "submitted") {
      return gate(
        "templates",
        "pending",
        `La plantilla ${definition.name} fue enviada a revisión`,
        "Esperar revisión de las plantillas críticas",
      );
    }
    if (template.provisioningStatus === "in_review") {
      return gate(
        "templates",
        "pending",
        `La plantilla ${definition.name} está en revisión`,
        "Esperar aprobación de las plantillas críticas",
      );
    }
    if (template.provisioningStatus === "rejected") {
      return gate(
        "templates",
        "blocked",
        `La plantilla ${definition.name} fue rechazada${
          template.rejectionReason === null
            ? ""
            : `: ${template.rejectionReason}`
        }`,
        "Revisar el motivo de rechazo y sincronizar las plantillas",
      );
    }
    if (template.status !== "APPROVED") {
      if (template.status === "PENDING") {
        return gate(
          "templates",
          "pending",
          `La plantilla ${definition.name} está pendiente de aprobación`,
          "Esperar aprobación de las plantillas críticas",
        );
      }
      if (template.status === "REJECTED") {
        return gate(
          "templates",
          "blocked",
          `La plantilla ${definition.name} fue rechazada${
            template.rejectionReason === null
              ? ""
              : `: ${template.rejectionReason}`
          }`,
          "Revisar el motivo de rechazo y sincronizar las plantillas",
        );
      }
      return gate(
        "templates",
        "blocked",
        `La plantilla ${definition.name} está deshabilitada${
          template.rejectionReason === null
            ? ""
            : `: ${template.rejectionReason}`
        }`,
        "Revisar por qué se deshabilitó y sincronizar las plantillas",
      );
    }
    if (template.name !== definition.name) {
      return gate(
        "templates",
        "blocked",
        `La plantilla crítica ${definition.name} no coincide con el nombre catalogado`,
        "Revisar el nombre de la plantilla y sincronizarla",
      );
    }
    if (template.locale !== definition.locale) {
      return gate(
        "templates",
        "blocked",
        `La plantilla ${definition.name} tiene locale ${template.locale}; se requiere ${definition.locale}`,
        "Corregir el locale aprobado y sincronizar las plantillas",
      );
    }
    if (template.category !== definition.category) {
      return gate(
        "templates",
        "blocked",
        `La plantilla ${definition.name} tiene categoría ${template.category ?? "desconocida"}; se requiere ${definition.category}`,
        "Corregir la categoría Utility y sincronizar las plantillas",
      );
    }
    if (
      template.catalogVersion !== undefined &&
      template.catalogVersion !== definition.version
    ) {
      return gate(
        "templates",
        "blocked",
        `La plantilla ${definition.name} usa la versión ${template.catalogVersion}; se requiere la versión ${definition.version}`,
        "Sincronizar la versión vigente de las plantillas críticas",
      );
    }
    if (
      template.content !== undefined &&
      template.content !== definition.content
    ) {
      return gate(
        "templates",
        "blocked",
        `La plantilla ${definition.name} tiene contenido distinto al catálogo vigente`,
        "Revisar el contenido remoto y sincronizar la versión vigente",
      );
    }
    const missingVariables = definition.variables.filter(
      (variable) => !template.variables.includes(variable),
    );
    if (missingVariables.length > 0) {
      return gate(
        "templates",
        "blocked",
        `La plantilla ${definition.name} no contiene las variables requeridas: ${missingVariables.join(", ")}`,
        "Corregir las variables y sincronizar las plantillas",
      );
    }
  }
  return gate(
    "templates",
    "ready",
    "Las cuatro plantillas críticas están aprobadas",
    "",
  );
}

function evaluateBilling(input: WhatsAppReadinessInput): WhatsAppReadinessGate {
  if (input.billing.status === "failed") {
    return gate(
      "billing",
      "failed",
      "No se pudo verificar el billing de Kapso",
      "Reintentar la verificación de billing",
    );
  }
  if (input.billing.status === "pending") {
    return gate(
      "billing",
      "pending",
      "El billing de Kapso todavía no está verificado",
      "Reintentar la verificación de billing",
    );
  }
  if (input.billing.mode !== "partner_managed") {
    return gate(
      "billing",
      "blocked",
      "El billing no está configurado como partner_managed",
      "Configurar billing partner_managed para la Clínica",
    );
  }
  if (input.billing.alertThresholdCents === null) {
    return gate(
      "billing",
      "blocked",
      "El umbral de alerta de crédito no está configurado",
      "Configurar un umbral de alerta antes de habilitar envíos",
    );
  }
  const creditReserveCents = input.billing.creditReserveCents ?? 0;
  if (input.billing.creditCents <= creditReserveCents) {
    return gate(
      "billing",
      "blocked",
      "La cuenta partner_managed no tiene crédito disponible",
      "Agregar crédito antes de habilitar envíos",
    );
  }
  if (!input.billing.chargesSeparated) {
    return gate(
      "billing",
      "blocked",
      "Los cargos de Meta no están separados de la atribución de la Clínica",
      "Corregir la separación de cargos de billing",
    );
  }
  return gate(
    "billing",
    "ready",
    "Billing partner_managed, crédito y cargos separados verificados",
    "",
  );
}

function evaluateE2E(input: WhatsAppReadinessInput): WhatsAppReadinessGate {
  if (input.e2e.status === "failed") {
    return gate(
      "e2e",
      "failed",
      "La última prueba E2E falló",
      "Ejecutar de nuevo la prueba E2E",
    );
  }
  if (
    input.e2e.status !== "passed" ||
    input.e2e.lastTestAt === null ||
    input.e2e.evidence === null
  ) {
    return gate(
      "e2e",
      "pending",
      "Todavía no existe evidencia de una prueba E2E exitosa",
      "Ejecutar una prueba E2E",
    );
  }
  if (input.e2e.evidenceScope !== "message-roundtrip") {
    return gate(
      "e2e",
      "pending",
      "El preflight de webhook pasó, pero falta una prueba sintética de envío, recepción y delivery",
      "Completar la prueba E2E de envío, recepción y delivery",
    );
  }
  return gate(
    "e2e",
    "ready",
    "Prueba E2E exitosa con evidencia registrada",
    "",
  );
}

function gate(
  code: WhatsAppReadinessGateCode,
  status: WhatsAppReadinessGateStatus,
  message: string,
  action: string,
): WhatsAppReadinessGate {
  return { action, code, message, status };
}
