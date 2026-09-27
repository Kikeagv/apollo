import type {
  WhatsAppConnectionStatus,
  WhatsAppConnectionType,
} from "./whatsapp-connection";
import type { WhatsAppTechnicalReadinessStatus } from "./whatsapp-readiness";

export const whatsappActivationModes = [
  "coexistence",
  "dedicated",
  "later",
  "not-integrated",
] as const;

export type WhatsAppActivationMode = (typeof whatsappActivationModes)[number];

export const whatsappActivationEvidenceSources = ["kapso", "deployed"] as const;
export type WhatsAppActivationEvidenceSource =
  (typeof whatsappActivationEvidenceSources)[number];

export const whatsappActivationIdentityStatuses = [
  "authenticated",
  "blocked",
] as const;
export type WhatsAppActivationIdentityStatus =
  (typeof whatsappActivationIdentityStatuses)[number];

export const whatsappOwnerAccessStatuses = [
  "blocked",
  "pending",
  "ready",
] as const;
export type WhatsAppOwnerAccessStatus =
  (typeof whatsappOwnerAccessStatuses)[number];

export const whatsappActivationMessagingStatuses = [
  "blocked",
  "synthetic-only",
  "enabled",
  "offboarded",
] as const;
export type WhatsAppActivationMessagingStatus =
  (typeof whatsappActivationMessagingStatuses)[number];

export const whatsappActivationCriterionCodes = [
  "scope-v1",
  "product-access",
  "connection-ownership",
  "technical-readiness",
  "messaging-capacity",
  "duplicate-onboarding",
  "existing-account",
  "pending-readiness",
  "stale-health",
  "retryable-operations",
  "synthetic-smoke",
  "consent-representation",
  "offboarding",
  "simulated-connection",
  "inbound-webhook",
  "transactional-outbound",
  "commercial-clinic",
  "owner-invitation",
  "admin-idempotency",
  "clinic-console",
  "template-catalog",
  "funding-health",
  "readiness-reconciliation",
  "consent-versioning",
  "welcome-return",
  "inbound-identity",
  "transactional-delivery",
  "real-e2e",
  "circuit-reactivation",
  "controlled-offboarding",
  "supervision-panel",
  "controlled-pilot",
] as const;

export type WhatsAppActivationCriterionCode =
  (typeof whatsappActivationCriterionCodes)[number];

export type WhatsAppActivationClosureCriterion = {
  code: WhatsAppActivationCriterionCode;
  behavior: string;
  issue: string;
  label: string;
  pendingReason: string;
  requiredExternalEvidence: readonly WhatsAppActivationEvidenceSource[];
  testPath: string;
};

/**
 * Matriz estable de cierre. El código es deliberadamente independiente de
 * los gates de tráfico: una evidencia faltante nunca puede convertirse en un
 * permiso implícito para enviar datos reales.
 */
export const whatsappActivationClosureCriteria = [
  {
    behavior:
      "Las modalidades coexistence y dedicated permiten activación; dedicated opera solo por API y no conserva WhatsApp Business App.",
    code: "scope-v1",
    issue: "APO-74 / APO-94",
    label: "Alcance de modalidad",
    pendingReason: "Confirmar la decisión de alcance de la modalidad.",
    requiredExternalEvidence: [],
    testPath: "src/domain/whatsapp-activation.test.ts",
  },
  {
    behavior:
      "La Identidad autenticada y el acceso del Médico propietario se validan por separado de la conexión.",
    code: "product-access",
    issue: "APO-75 / APO-94",
    label: "Acceso al producto",
    pendingReason:
      "Falta evidencia del acceso del Médico propietario en el entorno desplegado.",
    requiredExternalEvidence: ["deployed"],
    testPath: "src/server/application/clinic-access.integration.test.ts",
  },
  {
    behavior:
      "Cada Clínica conserva su propio customer, WABA, número y generación de provisión, con aislamiento RLS.",
    code: "connection-ownership",
    issue: "APO-74 / APO-82 / APO-83 / APO-85",
    label: "Propiedad y aislamiento de Conexión",
    pendingReason:
      "Falta confirmar en Kapso y en el entorno desplegado la asociación de la Conexión.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/whatsapp-connections.integration.test.ts",
  },
  {
    behavior:
      "La preparación técnica exige número, webhooks, templates, billing y E2E de la generación vigente.",
    code: "technical-readiness",
    issue: "APO-77 / APO-85 / APO-86",
    label: "Preparación técnica",
    pendingReason:
      "Falta evidencia externa de todos los gates técnicos de la generación vigente.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/domain/whatsapp-readiness.test.ts",
  },
  {
    behavior:
      "La capacidad de mensajería se informa aparte: bloqueada, solo sintética, habilitada por gates o retirada.",
    code: "messaging-capacity",
    issue: "APO-79 / APO-80 / APO-92 / APO-94",
    label: "Capacidad de mensajería",
    pendingReason:
      "Falta evidencia desplegada de la capacidad de mensajería correspondiente al estado mostrado.",
    requiredExternalEvidence: ["deployed"],
    testPath: "src/server/application/whatsapp-operations.test.ts",
  },
  {
    behavior:
      "Reintentar el alta no duplica el customer ni crea una segunda representación de la misma asociación.",
    code: "duplicate-onboarding",
    issue: "APO-76 / APO-83 / APO-84",
    label: "Alta idempotente",
    pendingReason:
      "Falta reproducir el reintento contra Kapso y el entorno desplegado.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/kapso-onboarding.test.ts",
  },
  {
    behavior:
      "Una cuenta o número existente se confirma sin apropiarse de una asociación ajena ni desconectar terceros.",
    code: "existing-account",
    issue: "APO-76 / APO-83 / APO-84",
    label: "Cuentas existentes",
    pendingReason:
      "Falta evidencia externa de una cuenta existente confirmada sin duplicación.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/kapso-onboarding.test.ts",
  },
  {
    behavior:
      "La preparación pendiente conserva su siguiente acción y no se presenta como una Conexión lista.",
    code: "pending-readiness",
    issue: "APO-77 / APO-85 / APO-94",
    label: "Preparación pendiente",
    pendingReason:
      "Falta evidencia desplegada del estado pendiente y su siguiente acción.",
    requiredExternalEvidence: ["deployed"],
    testPath: "src/server/application/whatsapp-readiness.test.ts",
  },
  {
    behavior:
      "La salud antigua, la generación obsoleta y un smoke viejo mantienen bloqueada la operación hasta una nueva prueba.",
    code: "stale-health",
    issue: "APO-77 / APO-91 / APO-92 / APO-94",
    label: "Salud y evidencia obsoletas",
    pendingReason:
      "Falta evidencia de entorno y proveedor para la invalidación de salud antigua.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/domain/whatsapp-readiness.test.ts",
  },
  {
    behavior:
      "Las operaciones administrativas reintentables conservan idempotencia y no relajan un gate al reintentar.",
    code: "retryable-operations",
    issue: "APO-84 / APO-85 / APO-91 / APO-92",
    label: "Operaciones reintentables",
    pendingReason:
      "Falta evidencia externa de un reintento administrativo seguro.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/whatsapp-operations.test.ts",
  },
  {
    behavior:
      "El smoke sintético cubre el circuito y conserva la procedencia del transporte externo; no habilita Pacientes reales.",
    code: "synthetic-smoke",
    issue: "APO-80 / APO-91 / APO-92",
    label: "Smoke sintético",
    pendingReason:
      "Falta evidencia del smoke ejecutado por Kapso y del entorno desplegado.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/whatsapp-operations.test.ts",
  },
  {
    behavior:
      "El primer contacto exige consentimiento y distingue flujo adulto de representación por Tutor; los gates legales permanecen activos.",
    code: "consent-representation",
    issue: "APO-78 / APO-87 / APO-88 / APO-93",
    label: "Consentimiento y representación",
    pendingReason: "Falta evidencia desplegada de los flujos adulto y Tutor.",
    requiredExternalEvidence: ["deployed"],
    testPath: "src/server/application/whatsapp-consent.test.ts",
  },
  {
    behavior:
      "El offboarding detiene envíos, retira webhooks y enlaces de forma idempotente, conserva export y permite reintentar.",
    code: "offboarding",
    issue: "APO-92",
    label: "Offboarding",
    pendingReason:
      "Falta evidencia de Kapso y del entorno desplegado para una retirada completa.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/whatsapp-operations.test.ts",
  },
  {
    behavior:
      "El modo simulado permite probar la Conexión por Clínica sin mezclarla con una asociación productiva, y el onboarding no ejecuta Kapso para esa ruta.",
    code: "simulated-connection",
    issue: "APO-75 / APO-81",
    label: "Conexión simulada",
    pendingReason:
      "Falta evidencia desplegada de una Conexión simulada aislada por Clínica.",
    requiredExternalEvidence: ["deployed"],
    testPath: "src/server/application/whatsapp-connections.test.ts",
  },
  {
    behavior:
      "Los mensajes entrantes de Kapso se reciben de forma durable y un takeover humano no pierde el contexto de la Clínica.",
    code: "inbound-webhook",
    issue: "APO-78 / APO-87 / APO-88 / APO-93",
    label: "Inbound y takeover",
    pendingReason:
      "Falta evidencia de Kapso y del entorno desplegado para inbound y takeover.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/whatsapp-inbound.test.ts",
  },
  {
    behavior:
      "Las entregas salientes transaccionales respetan la ventana operativa, la identidad de la Clínica y el estado de entrega.",
    code: "transactional-outbound",
    issue: "APO-79 / APO-89 / APO-90",
    label: "Outbound transaccional",
    pendingReason:
      "Falta evidencia de Kapso y del entorno desplegado para una entrega transaccional.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/whatsapp-outbound.test.ts",
  },
  {
    behavior:
      "El alta comercial recuperable distingue Clínicas reales de Clínicas sintéticas y conserva una invitación pendiente si falla el correo.",
    code: "commercial-clinic",
    issue: "APO-95",
    label: "Alta comercial recuperable",
    pendingReason:
      "Falta evidencia desplegada del alta comercial y de la recuperación de invitación.",
    requiredExternalEvidence: ["deployed"],
    testPath: "src/server/application/create-synthetic-clinic.test.ts",
  },
  {
    behavior:
      "La invitación del Médico propietario permite aceptar y recuperar la cuenta sin cruzar la Clínica de destino.",
    code: "owner-invitation",
    issue: "APO-96",
    label: "Invitación del propietario",
    pendingReason:
      "Falta evidencia desplegada de aceptación, recuperación e aislamiento de la cuenta propietaria.",
    requiredExternalEvidence: ["deployed"],
    testPath: "src/server/application/clinic-access.integration.test.ts",
  },
  {
    behavior:
      "Las operaciones administrativas pueden reintentarse de forma idempotente y conservan el historial de la Clínica.",
    code: "admin-idempotency",
    issue: "APO-97",
    label: "Idempotencia administrativa",
    pendingReason:
      "Falta evidencia desplegada de reintentos administrativos idempotentes.",
    requiredExternalEvidence: ["deployed"],
    testPath: "src/server/application/whatsapp-operations.test.ts",
  },
  {
    behavior:
      "La consola Apolo conserva el contexto de una sola Clínica al listar, crear y abrir su ficha.",
    code: "clinic-console",
    issue: "APO-98",
    label: "Consola por Clínica",
    pendingReason:
      "Falta evidencia desplegada de navegación y aislamiento por Clínica en la consola.",
    requiredExternalEvidence: ["deployed"],
    testPath: "src/server/application/subscription-support.test.ts",
  },
  {
    behavior:
      "El catálogo común se provisiona por WABA y un fallo no presenta templates como disponibles.",
    code: "template-catalog",
    issue: "APO-99",
    label: "Catálogo de templates",
    pendingReason:
      "Falta evidencia de Kapso y del entorno desplegado para el catálogo por WABA.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/whatsapp-readiness.test.ts",
  },
  {
    behavior:
      "Funding, capacidad y salud operativa se muestran como señales separadas y no sustituyen los gates de preparación.",
    code: "funding-health",
    issue: "APO-100",
    label: "Funding y salud",
    pendingReason:
      "Falta evidencia de Kapso y del entorno desplegado para separar capacidad y salud.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/whatsapp-readiness.test.ts",
  },
  {
    behavior:
      "La reconciliación de preparación actualiza solo la generación vigente y conserva un bloqueo ante resultados obsoletos.",
    code: "readiness-reconciliation",
    issue: "APO-101",
    label: "Reconciliación de preparación",
    pendingReason:
      "Falta evidencia de Kapso y del entorno desplegado para reconciliación de la generación vigente.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/whatsapp-readiness.test.ts",
  },
  {
    behavior:
      "El consentimiento de Contacto, Paciente y Tutor conserva versión, alcance, evidencia e historial; un cambio de versión exige nueva aceptación.",
    code: "consent-versioning",
    issue: "APO-102",
    label: "Versión de consentimiento",
    pendingReason:
      "Falta evidencia desplegada de consentimiento adulto, Tutor, opt-out y cambio de versión.",
    requiredExternalEvidence: ["deployed"],
    testPath: "src/server/application/whatsapp-consent.test.ts",
  },
  {
    behavior:
      "La bienvenida y el retorno de activación son verificables y no convierten una invitación o Conexión pendiente en acceso listo.",
    code: "welcome-return",
    issue: "APO-103",
    label: "Bienvenida y retorno",
    pendingReason:
      "Falta evidencia desplegada de bienvenida, activación y retorno verificable.",
    requiredExternalEvidence: ["deployed"],
    testPath:
      "src/server/application/accept-clinic-owner-invitation.integration.test.ts",
  },
  {
    behavior:
      "El inbound durable resuelve la Identidad de WhatsApp y activa takeover humano sin aplicar defaults ante ambigüedad o urgencia.",
    code: "inbound-identity",
    issue: "APO-104",
    label: "Identidad inbound",
    pendingReason:
      "Falta evidencia de Kapso y del entorno desplegado para identidad inbound y takeover.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/whatsapp-inbound.test.ts",
  },
  {
    behavior:
      "Las citas salientes y sus entregas transaccionales conservan idempotencia, trazabilidad y la separación de tráfico real.",
    code: "transactional-delivery",
    issue: "APO-105",
    label: "Entrega de citas",
    pendingReason:
      "Falta evidencia de Kapso y del entorno desplegado para outbound de citas.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/whatsapp-outbound.test.ts",
  },
  {
    behavior:
      "El E2E real y el smoke de transporte se ejecutan con la generación vigente y mantienen la restricción de Pacientes reales.",
    code: "real-e2e",
    issue: "APO-106",
    label: "E2E y smoke de transporte",
    pendingReason:
      "Falta evidencia de Kapso y del entorno desplegado para el E2E real y smoke de transporte.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/whatsapp-operations.test.ts",
  },
  {
    behavior:
      "La reactivación del circuito exige una causa corregida y evidencia válida antes de volver a permitir operaciones.",
    code: "circuit-reactivation",
    issue: "APO-107",
    label: "Reactivación del circuito",
    pendingReason:
      "Falta evidencia de Kapso y del entorno desplegado para reactivar el circuito con seguridad.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/whatsapp-circuit-breaker.test.ts",
  },
  {
    behavior:
      "El offboarding controlado es idempotente, detiene tráfico y deja la Conexión en un estado recuperable sin borrar la evidencia.",
    code: "controlled-offboarding",
    issue: "APO-108",
    label: "Offboarding controlado",
    pendingReason:
      "Falta evidencia de Kapso y del entorno desplegado para offboarding controlado.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/whatsapp-operations.test.ts",
  },
  {
    behavior:
      "El panel de supervisión muestra resumen, Plantillas y Sistema con el contexto y estado de la Clínica seleccionada.",
    code: "supervision-panel",
    issue: "APO-109",
    label: "Panel de supervisión",
    pendingReason:
      "Falta evidencia desplegada del panel de supervisión por Clínica.",
    requiredExternalEvidence: ["deployed"],
    testPath: "src/server/application/whatsapp-activation.test.ts",
  },
  {
    behavior:
      "El piloto controlado conserva criterios de entrada, evidencia del smoke y una ruta explícita de cierre de APO-74.",
    code: "controlled-pilot",
    issue: "APO-110",
    label: "Piloto controlado",
    pendingReason:
      "Falta evidencia de Kapso y del entorno desplegado para el piloto controlado.",
    requiredExternalEvidence: ["kapso", "deployed"],
    testPath: "src/server/application/whatsapp-operations.test.ts",
  },
] as const satisfies readonly WhatsAppActivationClosureCriterion[];

export type WhatsAppActivationEvidence = {
  criterionCode: WhatsAppActivationCriterionCode;
  evidenceReference: string | null;
  pendingReason?: string | null;
  provisioningEventId: string | null;
  recordedAt: Date;
  source: WhatsAppActivationEvidenceSource;
};

export type WhatsAppActivationContractInput = {
  clinicId: string;
  clinicIsSynthetic: boolean;
  clinicName: string;
  connection: {
    connectionType: WhatsAppConnectionType;
    provider: "kapso" | "simulated";
    status: WhatsAppConnectionStatus;
  } | null;
  currentProvisioningEventId: string | null;
  evidence: readonly WhatsAppActivationEvidence[];
  identityStatus: WhatsAppActivationIdentityStatus;
  ownerAccess: WhatsAppOwnerAccessStatus;
  requestedMode: WhatsAppActivationMode | null;
  smoke: {
    provisioningEventId: string | null;
    providerTransportVerified: boolean;
    realPatientsEnabled: boolean;
    status: "failed" | "passed" | "pending";
    syntheticContact: boolean;
  };
  technicalReadiness: WhatsAppTechnicalReadinessStatus;
  trafficAllowed: boolean;
  trafficStatus: "blocked" | "enabled" | "offboarded";
};

export type WhatsAppActivationScope = {
  allowed: boolean;
  requestedMode: WhatsAppActivationMode | null;
  status: "deferred" | "pending" | "v1";
  v1Mode: "coexistence" | "dedicated";
};

export type WhatsAppActivationCriterionResult =
  WhatsAppActivationClosureCriterion & {
    evidence: Partial<
      Record<WhatsAppActivationEvidenceSource, WhatsAppActivationEvidence>
    >;
    pending: string | null;
    status: "pending" | "verified";
  };

export type WhatsAppActivationContract = {
  clinicId: string;
  clinicName: string;
  closureStatus: "blocked" | "pending" | "ready";
  criteria: WhatsAppActivationCriterionResult[];
  gatesRemainEnforced: true;
  scope: WhatsAppActivationScope;
  states: {
    connection: "not-configured" | WhatsAppConnectionStatus;
    identity: WhatsAppActivationIdentityStatus;
    messaging: WhatsAppActivationMessagingStatus;
    ownerAccess: WhatsAppOwnerAccessStatus;
    technicalReadiness: WhatsAppTechnicalReadinessStatus;
  };
};

export function evaluateWhatsAppActivationContract(
  input: WhatsAppActivationContractInput,
): WhatsAppActivationContract {
  const scope = evaluateScope(input.requestedMode);
  const criteria = whatsappActivationClosureCriteria.map((criterion) =>
    evaluateCriterion(
      criterion,
      input.evidence,
      input.currentProvisioningEventId,
    ),
  );
  const allCriteriaVerified = criteria.every(
    (criterion) => criterion.status === "verified",
  );
  const states = {
    connection: input.connection?.status ?? "not-configured",
    identity: input.identityStatus,
    messaging: evaluateMessagingStatus(input),
    ownerAccess: input.ownerAccess,
    technicalReadiness: input.technicalReadiness,
  } satisfies WhatsAppActivationContract["states"];

  return {
    clinicId: input.clinicId,
    clinicName: input.clinicName,
    closureStatus:
      !scope.allowed || isActivationBlocked(input)
        ? "blocked"
        : allCriteriaVerified && isActivationOperationallyReady(input)
          ? "ready"
          : "pending",
    criteria,
    gatesRemainEnforced: true,
    scope,
    states,
  };
}

export function validateWhatsAppActivationEvidence(input: {
  criterionCode: WhatsAppActivationCriterionCode;
  evidenceReference?: string | null;
  pendingReason?: string | null;
  provisioningEventId?: string | null;
  recordedAt: Date;
  source: WhatsAppActivationEvidenceSource;
}): WhatsAppActivationEvidence {
  const criterion: WhatsAppActivationClosureCriterion | undefined =
    whatsappActivationClosureCriteria.find(
      (candidate) => candidate.code === input.criterionCode,
    );
  if (criterion === undefined) {
    throw new Error("El criterio de cierre de WhatsApp no existe");
  }
  if (!criterion.requiredExternalEvidence.includes(input.source)) {
    throw new Error(
      `El criterio ${criterion.label} no requiere evidencia de ${input.source}`,
    );
  }

  const evidenceReference = normalizeOptionalText(input.evidenceReference);
  const pendingReason = normalizeOptionalText(input.pendingReason);
  if (
    (evidenceReference === null && pendingReason === null) ||
    (evidenceReference !== null && pendingReason !== null)
  ) {
    throw new Error(
      "Registra una referencia de evidencia o una razón de pendiente, pero no ambas",
    );
  }
  if (
    (evidenceReference !== null &&
      containsSensitiveEvidence(evidenceReference)) ||
    (pendingReason !== null && containsSensitiveEvidence(pendingReason))
  ) {
    throw new Error(
      "La referencia de evidencia no puede contener secretos, credenciales ni payloads",
    );
  }
  if (
    evidenceReference !== null &&
    input.source === "kapso" &&
    (input.provisioningEventId === null ||
      input.provisioningEventId === undefined)
  ) {
    throw new Error(
      "La evidencia verificada debe referenciar la generación vigente de provisión",
    );
  }

  return {
    criterionCode: input.criterionCode,
    evidenceReference,
    pendingReason,
    provisioningEventId: input.provisioningEventId ?? null,
    recordedAt: input.recordedAt,
    source: input.source,
  };
}

function evaluateScope(
  requestedMode: WhatsAppActivationMode | null,
): WhatsAppActivationScope {
  if (requestedMode === "coexistence") {
    return {
      allowed: true,
      requestedMode,
      status: "v1",
      v1Mode: "coexistence",
    };
  }
  if (requestedMode === "dedicated") {
    return {
      allowed: true,
      requestedMode,
      status: "v1",
      v1Mode: "dedicated",
    };
  }
  if (requestedMode === "later" || requestedMode === "not-integrated") {
    return {
      allowed: false,
      requestedMode,
      status: "deferred",
      v1Mode: "coexistence",
    };
  }
  return {
    allowed: false,
    requestedMode: null,
    status: "pending",
    v1Mode: "coexistence",
  };
}

function evaluateCriterion(
  criterion: WhatsAppActivationClosureCriterion,
  evidence: readonly WhatsAppActivationEvidence[],
  currentProvisioningEventId: string | null,
): WhatsAppActivationCriterionResult {
  const criterionEvidence: Partial<
    Record<WhatsAppActivationEvidenceSource, WhatsAppActivationEvidence>
  > = {};
  for (const item of evidence) {
    if (
      item.criterionCode === criterion.code &&
      item.provisioningEventId === currentProvisioningEventId &&
      (criterionEvidence[item.source] === undefined ||
        criterionEvidence[item.source]!.recordedAt < item.recordedAt)
    ) {
      criterionEvidence[item.source] = item;
    }
  }

  const pendingSource = criterion.requiredExternalEvidence.find(
    (source) =>
      !hasEvidenceReference(criterionEvidence[source]?.evidenceReference) ||
      criterionEvidence[source] === undefined,
  );
  const pending =
    pendingSource === undefined
      ? null
      : (criterionEvidence[pendingSource]?.pendingReason ??
        criterion.pendingReason);

  return {
    ...criterion,
    evidence: criterionEvidence,
    pending,
    status: pending === null ? "verified" : "pending",
  };
}

function evaluateMessagingStatus(
  input: WhatsAppActivationContractInput,
): WhatsAppActivationMessagingStatus {
  if (
    input.trafficStatus === "offboarded" ||
    input.connection?.status === "disconnected"
  ) {
    return "offboarded";
  }
  if (
    input.trafficStatus === "enabled" &&
    input.trafficAllowed &&
    isActivationOperationallyReady(input)
  ) {
    return "enabled";
  }
  if (
    input.connection?.status === "ready" &&
    input.technicalReadiness === "ready" &&
    input.smoke.status === "passed" &&
    input.smoke.syntheticContact &&
    !input.smoke.realPatientsEnabled &&
    isSmokeCurrent(input) &&
    (input.connection?.provider !== "kapso" ||
      input.smoke.providerTransportVerified)
  ) {
    return "synthetic-only";
  }
  return "blocked";
}

function isActivationOperationallyReady(
  input: WhatsAppActivationContractInput,
) {
  return (
    input.identityStatus === "authenticated" &&
    input.ownerAccess === "ready" &&
    input.connection?.status === "ready" &&
    input.technicalReadiness === "ready" &&
    !input.clinicIsSynthetic &&
    input.smoke.status === "passed" &&
    input.smoke.syntheticContact &&
    !input.smoke.realPatientsEnabled &&
    isSmokeCurrent(input) &&
    (input.connection.provider !== "kapso" ||
      input.smoke.providerTransportVerified)
  );
}

function isSmokeCurrent(input: WhatsAppActivationContractInput) {
  return input.smoke.provisioningEventId === input.currentProvisioningEventId;
}

function isActivationBlocked(input: WhatsAppActivationContractInput) {
  return (
    input.identityStatus === "blocked" ||
    input.ownerAccess === "blocked" ||
    input.connection?.status === "blocked" ||
    input.connection?.status === "disconnected" ||
    input.technicalReadiness === "blocked" ||
    input.trafficStatus === "offboarded"
  );
}

function hasEvidenceReference(value: string | null | undefined) {
  return value !== null && value !== undefined && value.trim() !== "";
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized === undefined || normalized === "" ? null : normalized;
}

function containsSensitiveEvidence(value: string) {
  return (
    /\b(?:authorization|x-api-key|api[_-]?key|access[_-]?token|secret|password|token)\b\s*[:=]/i.test(
      value,
    ) ||
    /\bbearer\s+\S+/i.test(value) ||
    /^[a-z][a-z\d+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(value) ||
    /\b(?:otp|one[- ]time password|qr(?: code)?|payload)\b/i.test(value) ||
    /^\s*[\[{]/.test(value)
  );
}
