import {
  currentWhatsAppNumberHealth,
  type WhatsAppNumberHealth,
} from "./whatsapp-readiness";
import type { WhatsAppSetupLinkStatus } from "./whatsapp-setup-link";

export type ClinicActivationStepId =
  | "clinic-registration"
  | "setup-link"
  | "inbound-roundtrip"
  | "template-delivery";

export type ClinicActivationStepStatus = "completed" | "failed" | "pending";

export type ClinicActivationJourney = {
  enrollmentProgress: "completed" | "in-progress" | "pending";
  providerHealth: {
    checkedAt: Date | null;
    status: "healthy" | "issue" | "unverified";
  };
  realTrafficReady: boolean;
  steps: Array<{
    id: ClinicActivationStepId;
    status: ClinicActivationStepStatus;
    updatedAt: Date | null;
  }>;
};

export type ClinicActivationJourneyInput = {
  clinicRegistered: boolean;
  ownerAssociated: boolean;
  providerHealth: WhatsAppNumberHealth;
  providerHealthCheckedAt: Date | null;
  setupLinkCreatedAt: Date | null;
  setupLinkDelivery: {
    occurredAt: Date;
    result: "failed" | "succeeded";
    setupLinkId: string;
  } | null;
  setupLinkId: string | null;
  setupLinkStatus: WhatsAppSetupLinkStatus | null;
  now?: Date;
};

/**
 * Construye el recorrido visible de Activación y mantiene la salud operativa
 * separada de la evidencia que demuestra transporte de mensajes.
 */
export function buildClinicActivationJourney(
  input: ClinicActivationJourneyInput,
): ClinicActivationJourney {
  const clinicRegistrationCompleted =
    input.clinicRegistered && input.ownerAssociated;
  const currentDelivery =
    input.setupLinkDelivery?.setupLinkId === input.setupLinkId
      ? input.setupLinkDelivery
      : null;
  const setupLinkStatus: ClinicActivationStepStatus =
    currentDelivery?.result === "succeeded"
      ? "completed"
      : currentDelivery?.result === "failed"
        ? "failed"
        : "pending";
  const currentHealth = currentWhatsAppNumberHealth({
    health: input.providerHealth,
    healthCheckedAt: input.providerHealthCheckedAt,
    now: input.now,
  });

  return {
    enrollmentProgress:
      clinicRegistrationCompleted && input.setupLinkStatus === "used"
        ? "completed"
        : clinicRegistrationCompleted
          ? "in-progress"
          : "pending",
    providerHealth: {
      checkedAt: input.providerHealthCheckedAt,
      status:
        currentHealth === "healthy" || currentHealth === "limited"
          ? "healthy"
          : currentHealth === "degraded" ||
              currentHealth === "unhealthy" ||
              currentHealth === "error"
            ? "issue"
            : "unverified",
    },
    realTrafficReady: false,
    steps: [
      {
        id: "clinic-registration",
        status: clinicRegistrationCompleted ? "completed" : "pending",
        updatedAt: null,
      },
      {
        id: "setup-link",
        status: setupLinkStatus,
        updatedAt: currentDelivery?.occurredAt ?? input.setupLinkCreatedAt,
      },
      { id: "inbound-roundtrip", status: "pending", updatedAt: null },
      { id: "template-delivery", status: "pending", updatedAt: null },
    ],
  };
}
