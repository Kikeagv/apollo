import type { WhatsAppConnectionStatus } from "./whatsapp-connection";
import type { WhatsAppTechnicalReadinessStatus } from "./whatsapp-readiness";
import type { WhatsAppProviderId } from "./whatsapp-runtime";

export const whatsappRealTrafficGateCodes = [
  "consent",
  "contract",
  "privacy",
  "retention",
  "dpa",
  "transfers",
  "billing",
  "product-approval",
] as const;

export type WhatsAppRealTrafficGateCode =
  (typeof whatsappRealTrafficGateCodes)[number];

export type WhatsAppRealTrafficGateInput = {
  evidenceReference: string | null;
  ready: boolean;
};

export type WhatsAppRealTrafficBlocker = {
  code:
    | WhatsAppRealTrafficGateCode
    | "circuit-breaker"
    | "clinic-synthetic"
    | "connection"
    | "offboarded"
    | "smoke"
    | "smoke-generation"
    | "technical-readiness"
    | "traffic-not-enabled"
    | "provider-transport-unverified";
  message: string;
};

export type WhatsAppRealTrafficEvaluation = {
  allowed: boolean;
  blockers: WhatsAppRealTrafficBlocker[];
};

export function evaluateWhatsAppRealTraffic(input: {
  circuitStatus: "closed" | "open" | null;
  clinicIsSynthetic: boolean;
  connectionGenerationId?: string | null;
  connectionProvider?: WhatsAppProviderId;
  connectionStatus: WhatsAppConnectionStatus | null;
  gates: Partial<
    Record<WhatsAppRealTrafficGateCode, WhatsAppRealTrafficGateInput>
  >;
  /** Requiere la habilitación manual cuando se evalúa un guard de envío. */
  requireEnabled?: boolean;
  smoke: {
    controlledTestContact?: boolean;
    providerTransportVerified?: boolean;
    provisioningEventId?: string | null;
    realPatientsEnabled: boolean;
    status: "failed" | "passed" | "pending";
    syntheticContact: boolean;
  };
  technicalBlockers?: string[];
  technicalReadiness: WhatsAppTechnicalReadinessStatus;
  trafficStatus: "blocked" | "enabled" | "offboarded";
}): WhatsAppRealTrafficEvaluation {
  const blockers: WhatsAppRealTrafficBlocker[] = [];

  if (input.trafficStatus === "offboarded") {
    blockers.push({
      code: "offboarded",
      message:
        "La Conexión fue retirada; reconéctela explícitamente antes de habilitarla",
    });
  }
  if (input.connectionStatus !== "ready") {
    blockers.push({
      code: "connection",
      message: "La Conexión de WhatsApp no está en estado ready",
    });
  }
  if (input.technicalReadiness !== "ready") {
    const technicalMessage = input.technicalBlockers?.join("; ");
    blockers.push({
      code: "technical-readiness",
      message:
        technicalMessage === undefined || technicalMessage === ""
          ? "Los gates técnicos de WhatsApp todavía no están listos"
          : technicalMessage,
    });
  }
  if (input.circuitStatus !== "closed") {
    blockers.push({
      code: "circuit-breaker",
      message: "El circuit breaker de WhatsApp debe estar cerrado",
    });
  }
  if (input.clinicIsSynthetic) {
    blockers.push({
      code: "clinic-synthetic",
      message: "Una Clínica sintética no puede recibir tráfico real",
    });
  }
  if (
    input.smoke.status !== "passed" ||
    (!input.smoke.syntheticContact &&
      input.smoke.controlledTestContact !== true) ||
    input.smoke.realPatientsEnabled
  ) {
    blockers.push({
      code: "smoke",
      message:
        "Debe existir un smoke sintético exitoso que no habilite Pacientes reales",
    });
  }
  if (
    input.connectionGenerationId !== undefined &&
    (input.connectionGenerationId === null ||
      input.smoke.provisioningEventId !== input.connectionGenerationId)
  ) {
    blockers.push({
      code: "smoke-generation",
      message:
        "El smoke sintético no corresponde a la generación actual de la Conexión",
    });
  }
  if (input.requireEnabled === true && input.trafficStatus !== "enabled") {
    blockers.push({
      code: "traffic-not-enabled",
      message:
        "El tráfico real de WhatsApp requiere habilitación manual explícita",
    });
  }
  if (
    input.connectionProvider === "kapso" &&
    input.smoke.providerTransportVerified !== true
  ) {
    blockers.push({
      code: "provider-transport-unverified",
      message:
        "El smoke de Kapso no conserva verificación externa completa para enviar tráfico real",
    });
  }

  for (const code of whatsappRealTrafficGateCodes) {
    const gate = input.gates[code];
    if (gate?.ready !== true || !hasEvidence(gate.evidenceReference)) {
      blockers.push({
        code,
        message: `Falta evidencia del gate ${whatsappRealTrafficGateLabel(code)}`,
      });
    }
  }

  return { allowed: blockers.length === 0, blockers };
}

export function whatsappRealTrafficGateLabel(
  code: WhatsAppRealTrafficGateCode,
) {
  return {
    billing: "billing adjunto",
    consent: "consentimiento",
    contract: "contrato",
    dpa: "DPA",
    privacy: "privacidad",
    "product-approval": "aprobación de producto",
    retention: "retención",
    transfers: "transferencias internacionales",
  }[code];
}

function hasEvidence(value: string | null | undefined) {
  return value !== null && value !== undefined && value.trim() !== "";
}
