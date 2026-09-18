export const administrativeOperationKinds = [
  "transfer-payment",
  "subscription-status",
  "support-session",
] as const;

export type AdministrativeOperationKind =
  (typeof administrativeOperationKinds)[number];

export type AdministrativeOperationFeedback =
  | { status: "idle" }
  | { message: string; status: "validation-pending" }
  | { message: string; status: "pending" }
  | {
      canRetry: false;
      operationKey: string;
      status: "succeeded";
    }
  | {
      canRetry: true;
      message: string;
      status: "failed";
    };

export function createAdministrativeOperationKey(
  kind: AdministrativeOperationKind,
  attemptId: string,
) {
  const normalizedAttemptId = attemptId.trim();
  if (normalizedAttemptId.length === 0) {
    throw new Error("La operación requiere un identificador de intento");
  }
  return `${kind}:${normalizedAttemptId}`;
}

export function getAdministrativeOperationFeedback(input: {
  attempted: boolean;
  errorMessage?: string;
  isError: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isValid: boolean;
  operationKey?: string;
}): AdministrativeOperationFeedback {
  if (!input.attempted) return { status: "idle" };
  if (!input.isValid) {
    return {
      message: "Completa los datos requeridos antes de enviar la operación.",
      status: "validation-pending",
    };
  }
  if (input.isPending) {
    return {
      message: "Procesando la operación…",
      status: "pending",
    };
  }
  if (input.isSuccess && input.operationKey !== undefined) {
    return {
      canRetry: false,
      operationKey: input.operationKey,
      status: "succeeded",
    };
  }
  if (input.isError) {
    const errorMessage = input.errorMessage?.trim();
    return {
      canRetry: true,
      message:
        errorMessage === undefined || errorMessage.length === 0
          ? "No se pudo confirmar la operación. Puedes reintentarlo de forma segura."
          : errorMessage,
      status: "failed",
    };
  }
  return {
    message: "Esperando confirmación de la operación…",
    status: "pending",
  };
}
