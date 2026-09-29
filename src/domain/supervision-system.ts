import type { WhatsAppRuntimeDiagnostic } from "./whatsapp-runtime";

export type SupervisionWorkerKey =
  "appointments" | "inbound" | "outbound" | "provisioning" | "webhooks";

export type SupervisionWorkerQueue = {
  pending: number;
  processing: number;
  attention: number;
};

export type SupervisionSystemProblemSource =
  "circuit-breaker" | "connection" | "delivery" | "inbound" | "readiness";

export type SupervisionSystemProblemSeverity = "critical" | "high" | "medium";

export type SupervisionSystemProblem = {
  id: string;
  clinicId: string | null;
  clinicName: string | null;
  area: string;
  reason: string;
  nextAction: string;
  createdAt: Date;
  /** Datos de agrupación que las fuentes pueden aportar sin perder el registro original. */
  causeKey?: string;
  lastSeenAt?: Date;
  resourceKey?: string;
  resourceLabel?: string;
  resourceReference?: string;
  severity?: SupervisionSystemProblemSeverity;
  source?: SupervisionSystemProblemSource;
};

export type SupervisionSystemProblemGroup = {
  id: string;
  clinicId: string | null;
  clinicName: string | null;
  area: string;
  causeKey: string;
  reason: string;
  nextAction: string;
  resourceLabel: string;
  severity: SupervisionSystemProblemSeverity;
  source: SupervisionSystemProblemSource | null;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  problems: SupervisionSystemProblem[];
};

export type SupervisionSystemQueueSnapshot = {
  schedulerConfigured: boolean;
  workers: Record<SupervisionWorkerKey, SupervisionWorkerQueue>;
  globalProblems: SupervisionSystemProblem[];
};

export type SupervisionSystemOverview = {
  provider: {
    id: WhatsAppRuntimeDiagnostic["provider"];
    configured: boolean;
    missing: WhatsAppRuntimeDiagnostic["missing"];
  };
  workers: Array<{
    key: SupervisionWorkerKey;
    label: string;
    configuration: "missing" | "ready";
    queue: SupervisionWorkerQueue;
    status: "attention" | "idle" | "not-configured" | "working";
  }>;
  globalProblems: SupervisionSystemProblem[];
};

const problemSeverityRank: Record<SupervisionSystemProblemSeverity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
};

/** Agrupa la proyección abierta por Clínica, causa y recurso; conserva cada fila para el detalle. */
export function groupSupervisionSystemProblems(
  problems: readonly SupervisionSystemProblem[],
): SupervisionSystemProblemGroup[] {
  const groups = new Map<string, SupervisionSystemProblemGroup>();

  for (const problem of problems) {
    const causeKey = problem.causeKey ?? normalizedProblemKey(problem.reason);
    const resourceKey = problem.resourceKey ?? problem.area;
    const source = problem.source ?? null;
    const groupId = JSON.stringify([problem.clinicId, causeKey, resourceKey]);
    const lastSeenAt = problem.lastSeenAt ?? problem.createdAt;
    const severity = problem.severity ?? "medium";
    const existing = groups.get(groupId);

    if (existing === undefined) {
      groups.set(groupId, {
        id: groupId,
        clinicId: problem.clinicId,
        clinicName: problem.clinicName,
        area: problem.area,
        causeKey,
        reason: problem.reason,
        nextAction: problem.nextAction,
        resourceLabel: problem.resourceLabel ?? problem.area,
        severity,
        source,
        count: 1,
        firstSeenAt: problem.createdAt,
        lastSeenAt,
        problems: [problem],
      });
      continue;
    }

    existing.count += 1;
    existing.problems.push(problem);
    if (problem.createdAt < existing.firstSeenAt) {
      existing.firstSeenAt = problem.createdAt;
    }
    if (lastSeenAt >= existing.lastSeenAt) {
      existing.lastSeenAt = lastSeenAt;
      existing.reason = problem.reason;
      existing.nextAction = problem.nextAction;
      existing.clinicName = problem.clinicName ?? existing.clinicName;
    }
    if (
      problemSeverityRank[severity] > problemSeverityRank[existing.severity]
    ) {
      existing.severity = severity;
    }
  }

  return [...groups.values()].sort((left, right) => {
    const severityDifference =
      problemSeverityRank[right.severity] - problemSeverityRank[left.severity];
    if (severityDifference !== 0) return severityDifference;
    return (
      left.firstSeenAt.valueOf() - right.firstSeenAt.valueOf() ||
      right.lastSeenAt.valueOf() - left.lastSeenAt.valueOf()
    );
  });
}

function normalizedProblemKey(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

const workerLabels: Record<SupervisionWorkerKey, string> = {
  appointments: "Agenda y entregas transaccionales",
  inbound: "Mensajes entrantes",
  outbound: "Respuestas y estados de entrega",
  provisioning: "Provisionamiento y reconciliación",
  webhooks: "Eventos de webhook",
};

/** Resume colas existentes. La configuración no afirma que el proceso esté vivo. */
export function buildSupervisionSystemOverview(input: {
  runtime: WhatsAppRuntimeDiagnostic;
  queues: SupervisionSystemQueueSnapshot;
}): SupervisionSystemOverview {
  const workerOrder: SupervisionWorkerKey[] = [
    "webhooks",
    "inbound",
    "provisioning",
    "outbound",
    "appointments",
  ];

  return {
    globalProblems: input.queues.globalProblems,
    provider: {
      configured: input.runtime.configured,
      id: input.runtime.provider,
      missing: input.runtime.missing,
    },
    workers: workerOrder.map((key) => {
      const queue = input.queues.workers[key];
      const configuration = input.queues.schedulerConfigured
        ? "ready"
        : "missing";
      return {
        configuration,
        key,
        label: workerLabels[key],
        queue,
        status: workerStatus(queue, input.queues.schedulerConfigured),
      };
    }),
  };
}

function workerStatus(
  queue: SupervisionWorkerQueue,
  schedulerConfigured: boolean,
): SupervisionSystemOverview["workers"][number]["status"] {
  if (!schedulerConfigured) return "not-configured";
  if (queue.attention > 0) return "attention";
  if (queue.pending > 0 || queue.processing > 0) return "working";
  return "idle";
}
