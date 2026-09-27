import {
  evaluateClinicSupervision,
  type ClinicSupervisionInput,
  type ClinicSupervisionSummary,
} from "~/domain/clinic-supervision";
import type { WhatsAppConnectionStatus } from "~/domain/whatsapp-connection";
import {
  buildWhatsAppTemplateCatalogCoverage,
  type WhatsAppTemplateCatalogCoverage,
  type WhatsAppTemplateCoverageSource,
} from "~/domain/whatsapp-template-catalog";
import type { WhatsAppTechnicalReadinessStatus } from "~/domain/whatsapp-readiness";
import {
  buildSupervisionSystemOverview,
  type SupervisionSystemOverview,
  type SupervisionSystemQueueSnapshot,
} from "~/domain/supervision-system";
import type { WhatsAppRuntimeDiagnostic } from "~/domain/whatsapp-runtime";

export type ClinicSupervisionBaseSnapshot = {
  clinic: ClinicSupervisionInput["clinic"];
  owner: ClinicSupervisionInput["owner"];
};

type ClinicSupervisionReadiness = {
  billing: {
    creditCents: number;
    creditReserveCents?: number | null;
    kapsoMonthlyQuota?: number | null;
    kapsoQuotaConsumed?: number;
    kapsoQuotaInFlight?: number;
    kapsoQuotaReserved?: number;
  };
  connection: { status: WhatsAppConnectionStatus } | null;
  nextAction: string | null;
  readiness: {
    gates: Array<{
      action: string;
      code: "billing" | "e2e" | "number" | "templates" | "webhooks";
      message: string;
      status: "blocked" | "failed" | "pending" | "ready";
    }>;
    nextAction: string | null;
    status: "blocked" | "degraded" | "pending" | "ready";
    statusReason: string;
  };
  technicalStatus: WhatsAppTechnicalReadinessStatus;
};

type ClinicSupervisionOperations = {
  trafficEvaluation: {
    allowed: boolean;
    blockers: Array<{ code: string; message: string }>;
  };
  trafficStatus: "blocked" | "enabled" | "offboarded";
};

type ClinicSupervisionCircuit = {
  cause: string | null;
  nextAction: string;
  reason: string;
  status: "closed" | "open";
};

export type ClinicSupervisionDashboardDependencies = {
  store: {
    readClinic(input: {
      actorIdentityId: string;
      clinicId: string;
    }): Promise<ClinicSupervisionBaseSnapshot | null>;
  };
  readWhatsAppReadiness(input: {
    actorIdentityId: string;
    clinicId: string;
  }): Promise<ClinicSupervisionReadiness>;
  readWhatsAppOperations(input: {
    actorIdentityId: string;
    clinicId: string;
  }): Promise<ClinicSupervisionOperations>;
  readCircuitBreaker(input: {
    actorIdentityId: string;
    clinicId: string;
  }): Promise<ClinicSupervisionCircuit>;
};

export type SupervisionSystemQueueData = Omit<
  SupervisionSystemQueueSnapshot,
  "schedulerConfigured"
>;

/** Compone el resumen desde fuentes persistidas y decisiones canónicas de WhatsApp. */
export async function getClinicSupervisionSummary(
  input: { actorIdentityId: string; clinicId: string },
  dependencies: ClinicSupervisionDashboardDependencies,
): Promise<ClinicSupervisionSummary | null> {
  const base = await dependencies.store.readClinic(input);
  if (base === null) return null;

  const [readiness, operations, circuit] = await Promise.all([
    dependencies.readWhatsAppReadiness(input),
    dependencies.readWhatsAppOperations(input),
    dependencies.readCircuitBreaker(input),
  ]);
  const incompleteGate = readiness.readiness.gates.find(
    (gate) => gate.status !== "ready",
  );
  const billingGate = readiness.readiness.gates.find(
    (gate) => gate.code === "billing",
  ) ?? {
    action: "Reintentar la verificación de billing",
    code: "billing" as const,
    message: "No hay una evaluación de billing disponible.",
    status: "pending" as const,
  };

  return evaluateClinicSupervision({
    capacity: {
      billingGate,
      circuit,
      creditCents: readiness.billing.creditCents,
      creditReserveCents: readiness.billing.creditReserveCents ?? null,
      monthlyQuota: readiness.billing.kapsoMonthlyQuota ?? null,
      quotaConsumed: readiness.billing.kapsoQuotaConsumed ?? 0,
      quotaInFlight: readiness.billing.kapsoQuotaInFlight ?? 0,
      quotaReserved: readiness.billing.kapsoQuotaReserved ?? 0,
      trafficAllowed: operations.trafficEvaluation.allowed,
      trafficBlocker: operations.trafficEvaluation.blockers[0] ?? null,
      trafficStatus: operations.trafficStatus,
    },
    clinic: base.clinic,
    connection: {
      firstIncompleteGate: incompleteGate ?? null,
      nextAction: readiness.readiness.nextAction ?? readiness.nextAction,
      readinessReason: readiness.readiness.statusReason,
      status: readiness.connection?.status ?? null,
      technicalStatus: readiness.technicalStatus,
    },
    owner: base.owner,
  });
}

export async function getWhatsAppTemplateCatalogCoverage(
  input: { actorIdentityId: string },
  store: {
    readTemplateCoverage(input: {
      actorIdentityId: string;
    }): Promise<WhatsAppTemplateCoverageSource[]>;
  },
): Promise<WhatsAppTemplateCatalogCoverage> {
  const sources = await store.readTemplateCoverage(input);
  return buildWhatsAppTemplateCatalogCoverage(sources);
}

export async function getSupervisionSystemOverview(
  input: { actorIdentityId: string; schedulerConfigured: boolean },
  dependencies: {
    readRuntime(input: {
      actorIdentityId: string;
    }): Promise<WhatsAppRuntimeDiagnostic>;
    readQueues(input: {
      actorIdentityId: string;
    }): Promise<SupervisionSystemQueueData>;
  },
): Promise<SupervisionSystemOverview> {
  const [runtime, queues] = await Promise.all([
    dependencies.readRuntime(input),
    dependencies.readQueues(input),
  ]);

  return buildSupervisionSystemOverview({
    queues: { ...queues, schedulerConfigured: input.schedulerConfigured },
    runtime,
  });
}
