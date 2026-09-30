import {
  currentWhatsAppNumberHealth,
  type WhatsAppNumberHealth,
} from "./whatsapp-readiness";
import type { WhatsAppSetupLinkStatus } from "./whatsapp-setup-link";
import {
  whatsappSyntheticSmokeRoundtripStepCodes,
  type WhatsAppSyntheticSmokeResult,
  type WhatsAppSyntheticSmokeStep,
} from "./whatsapp-smoke";

export type ClinicActivationSmokeRun = WhatsAppSyntheticSmokeResult & {
  finishedAt: Date | null;
  id: string;
  provisioningEventId: string | null;
  startedAt: Date;
};

export type ClinicActivationStepId =
  | "clinic-registration"
  | "setup-link"
  | "inbound-roundtrip"
  | "template-delivery";

export type ClinicActivationStepStatus = "completed" | "failed" | "pending";

export type ClinicActivationJourney = {
  enrollmentProgress: "completed" | "in-progress" | "pending";
  inboundRoundtrip: {
    contactMaskedPhone: string | null;
    preflight: WhatsAppSyntheticSmokeStep | null;
    runId: string | null;
    startedAt: Date | null;
    status: ClinicActivationStepStatus;
    steps: WhatsAppSyntheticSmokeStep[];
    updatedAt: Date | null;
  };
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
  latestSmoke?: ClinicActivationSmokeRun | null;
  currentProvisioningEventId?: string | null;
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
  const inboundRoundtrip = buildInboundRoundtrip({
    currentProvisioningEventId: input.currentProvisioningEventId ?? null,
    latestSmoke: input.latestSmoke ?? null,
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
    inboundRoundtrip,
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
      {
        id: "inbound-roundtrip",
        status: inboundRoundtrip.status,
        updatedAt: inboundRoundtrip.updatedAt,
      },
      { id: "template-delivery", status: "pending", updatedAt: null },
    ],
  };
}

function buildInboundRoundtrip(input: {
  currentProvisioningEventId: string | null;
  latestSmoke: ClinicActivationSmokeRun | null;
}) {
  const smoke =
    input.latestSmoke?.requireRealRoundtrip === true &&
    input.latestSmoke.provisioningEventId === input.currentProvisioningEventId
      ? input.latestSmoke
      : null;
  const steps = whatsappSyntheticSmokeRoundtripStepCodes.map(
    (code): WhatsAppSyntheticSmokeStep =>
      smoke?.steps.find((step) => step.code === code) ??
      pendingRoundtripStep(code),
  );
  const hasFailedStep = steps.some((step) => step.status === "failed");
  const hasCompleteEvidence =
    steps.every((step) => step.status === "passed" && step.passed) &&
    smoke?.providerTransportVerified === true &&
    smoke.controlledTestContact === true &&
    (smoke.testContactId?.trim() ?? "") !== "" &&
    smoke.syntheticContact === false &&
    smoke.realPatientsEnabled === false &&
    smoke.status === "passed";
  const status: ClinicActivationStepStatus =
    smoke?.status === "failed" || hasFailedStep
      ? "failed"
      : hasCompleteEvidence
        ? "completed"
        : "pending";
  const observedAt = steps
    .flatMap((step) => (step.observedAt ? [step.observedAt] : []))
    .reduce<Date | null>(
      (latest, current) =>
        latest === null || current > latest ? current : latest,
      null,
    );

  return {
    contactMaskedPhone: smoke?.testContactMaskedPhone ?? null,
    preflight:
      smoke?.steps.find((step) => step.code === "webhook-preflight") ?? null,
    runId: smoke?.id ?? null,
    startedAt: smoke?.startedAt ?? null,
    status,
    steps,
    updatedAt: observedAt ?? smoke?.finishedAt ?? smoke?.startedAt ?? null,
  };
}

function pendingRoundtripStep(
  code: (typeof whatsappSyntheticSmokeRoundtripStepCodes)[number],
): WhatsAppSyntheticSmokeStep {
  return {
    code,
    evidence: null,
    eventId: null,
    message: "A la espera del mensaje de prueba",
    observedAt: null,
    passed: false,
    source: null,
    status: "pending",
  };
}
