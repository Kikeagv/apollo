import type { WhatsAppRuntimeDiagnostic } from "./whatsapp-runtime";

export type SupervisionWorkerKey =
  "appointments" | "inbound" | "outbound" | "provisioning" | "webhooks";

export type SupervisionWorkerQueue = {
  pending: number;
  processing: number;
  attention: number;
};

export type SupervisionSystemProblem = {
  id: string;
  clinicId: string | null;
  clinicName: string | null;
  area: string;
  reason: string;
  nextAction: string;
  createdAt: Date;
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
