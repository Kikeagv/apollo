import {
  aggregatePendingCases,
  type PendingCase,
  type PendingCategory,
  type PendingCategoryFilter,
  type PendingInbox,
  type PendingStatus,
} from "~/domain/pending";

export type PendingCaseReader = {
  listPendingCases(input: {
    clinicId: string;
    identityId: string;
    status: PendingStatus;
  }): Promise<PendingCase[]>;
};

export type PendingCaseResolver = {
  resolveAppointmentSelfManagementEscalation(input: {
    clinicId: string;
    escalationId: string;
    identityId: string;
  }): Promise<boolean>;
  resolveConversationEscalation(input: {
    clinicId: string;
    escalationId: string;
    identityId: string;
  }): Promise<boolean>;
  resolveTransactionalDeliveryAlert(input: {
    alertId: string;
    clinicId: string;
    identityId: string;
    now: Date;
  }): Promise<boolean>;
};

export type ListPendingCasesInput = {
  category?: PendingCategoryFilter;
  clinicId: string;
  identityId: string;
  status?: PendingStatus;
};

export async function listPendingCases(
  input: ListPendingCasesInput,
  store: PendingCaseReader,
): Promise<PendingInbox> {
  const status = input.status ?? "open";
  const cases = await store.listPendingCases({
    clinicId: input.clinicId,
    identityId: input.identityId,
    status,
  });
  return aggregatePendingCases(cases, {
    category: input.category,
    status,
  });
}

export type ResolvePendingCaseInput = {
  category: PendingCategory;
  clinicId: string;
  id: string;
  identityId: string;
};

export class PendingCaseResolutionError extends Error {
  constructor(category: PendingCategory) {
    super(
      `No se pudo resolver el pendiente de tipo ${category}. Puede que ya haya sido atendido o que requiera reintento.`,
    );
    this.name = "PendingCaseResolutionError";
  }
}

/** Ejecuta el comando original de cada fuente; la bandeja no tiene un descarte genérico. */
export async function resolvePendingCase(
  input: ResolvePendingCaseInput,
  resolver: PendingCaseResolver,
) {
  const resolved =
    input.category === "conversation"
      ? await resolver.resolveConversationEscalation({
          clinicId: input.clinicId,
          escalationId: input.id,
          identityId: input.identityId,
        })
      : input.category === "appointment"
        ? await resolver.resolveAppointmentSelfManagementEscalation({
            clinicId: input.clinicId,
            escalationId: input.id,
            identityId: input.identityId,
          })
        : await resolver.resolveTransactionalDeliveryAlert({
            alertId: input.id,
            clinicId: input.clinicId,
            identityId: input.identityId,
            now: new Date(),
          });

  if (!resolved) throw new PendingCaseResolutionError(input.category);
  return true;
}
