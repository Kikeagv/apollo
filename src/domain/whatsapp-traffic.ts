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
    | "template-delivery"
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
  /** Exige estado enabled cuando se valida un envío real. */
  requireEnabled?: boolean;
  smoke: {
    controlledTestContact?: boolean;
    providerTransportVerified?: boolean;
    templateDeliveryVerified?: boolean;
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
        "Debe existir una prueba de transporte exitosa con un Contacto controlado",
    });
  }
  if (input.smoke.templateDeliveryVerified !== true) {
    blockers.push({
      code: "template-delivery",
      message:
        "El Contacto de prueba no confirmó la entrega de una plantilla aprobada",
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
        "La prueba de transporte no corresponde a la generación actual de la Conexión",
    });
  }
  if (input.requireEnabled === true && input.trafficStatus !== "enabled") {
    blockers.push({
      code: "traffic-not-enabled",
      message:
        "El tráfico real de WhatsApp sigue bloqueado hasta completar la prueba de plantilla aprobada",
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
