export const PENDING_CATEGORIES = [
  "conversation",
  "appointment",
  "delivery",
] as const;

export type PendingCategory = (typeof PENDING_CATEGORIES)[number];
export type PendingCategoryFilter = PendingCategory | "all";
export type PendingStatus = "open" | "resolved";
export type PendingPriority = "urgent" | "high" | "normal" | "low";

export type PendingConversationTrigger =
  | "human-request"
  | "frustration"
  | "misunderstanding"
  | "voice-transcription-disabled"
  | "voice-transcription-failed";

type PendingCaseBase = {
  createdAt: Date;
  id: string;
  priority: PendingPriority | null;
  resolvedAt: Date | null;
  status: PendingStatus;
};

export type PendingConversationCase = PendingCaseBase & {
  category: "conversation";
  contact: { id: string; name: string };
  trigger: PendingConversationTrigger;
};

export type PendingAppointmentCase = PendingCaseBase & {
  action: "cancel" | "reschedule";
  appointmentId: string;
  category: "appointment";
  contact: { id: string; name: string };
  requestedStartsAt: Date | null;
};

export type PendingDeliveryCase = PendingCaseBase & {
  category: "delivery";
  delivery: {
    attempts: number;
    idempotencyKey: string;
    kind: "appointment-reminder" | "daily-agenda-pdf";
    lastError: string | null;
  };
};

export type PendingCase =
  PendingAppointmentCase | PendingConversationCase | PendingDeliveryCase;

export type PendingInbox = {
  counts: Record<PendingCategory, number>;
  items: PendingCase[];
  total: number;
};

const PRIORITY_RANK: Record<PendingPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Devuelve la posición de una prioridad registrada; los casos sin prioridad van al final. */
export function pendingPriorityRank(priority: PendingPriority | null) {
  return priority === null
    ? PENDING_CATEGORIES.length + 1
    : PRIORITY_RANK[priority];
}

/** Ordena primero la prioridad registrada y después los casos más antiguos. */
export function sortPendingCases(cases: readonly PendingCase[]) {
  return [...cases].sort((left, right) => {
    const priorityOrder =
      pendingPriorityRank(left.priority) - pendingPriorityRank(right.priority);
    if (priorityOrder !== 0) return priorityOrder;

    const ageOrder = left.createdAt.valueOf() - right.createdAt.valueOf();
    if (ageOrder !== 0) return ageOrder;

    return `${left.category}:${left.id}`.localeCompare(
      `${right.category}:${right.id}`,
    );
  });
}

/** Construye la vista unificada sin convertir sus tres modelos en una entidad nueva. */
export function aggregatePendingCases(
  cases: readonly PendingCase[],
  options: {
    category?: PendingCategoryFilter;
    status?: PendingStatus;
  } = {},
): PendingInbox {
  const status = options.status ?? "open";
  const category = options.category ?? "all";
  const casesInStatus = cases.filter((pending) => pending.status === status);
  const counts = Object.fromEntries(
    PENDING_CATEGORIES.map((pendingCategory) => [
      pendingCategory,
      casesInStatus.filter(
        ({ category: caseCategory }) => caseCategory === pendingCategory,
      ).length,
    ]),
  ) as Record<PendingCategory, number>;
  const items = sortPendingCases(
    casesInStatus.filter(
      (pending) => category === "all" || pending.category === category,
    ),
  );

  return { counts, items, total: casesInStatus.length };
}
