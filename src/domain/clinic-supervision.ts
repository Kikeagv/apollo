export type ClinicSupervisionStatus =
  "attention" | "blocked" | "pending" | "ready";

export type ClinicSupervisionStateKey =
  | "owner-access"
  | "subscription"
  | "whatsapp-connection"
  | "messaging-capacity";

export type ClinicSupervisionAction =
  | "activate-subscription"
  | "configure-whatsapp"
  | "open-payments"
  | "open-whatsapp"
  | "retry-owner-invitation"
  | "wait-owner-acceptance";

export type ClinicSupervisionState = {
  action: ClinicSupervisionAction | null;
  cause: string;
  destination: "owner" | "payments" | "whatsapp";
  key: ClinicSupervisionStateKey;
  label: string;
  nextAction: string;
  responsible: string;
  status: ClinicSupervisionStatus;
  value: string;
};

export type ClinicSupervisionInput = {
  clinic: {
    id: string;
    isSynthetic: boolean;
    name: string;
    subscriptionStatus: "active" | "suspended";
  };
  owner: {
    access: "blocked" | "pending" | "ready";
    invitationCanRetry: boolean;
    invitationDelivery: "failed" | "succeeded" | null;
    name: string | null;
  };
  connection: {
    status:
      | "blocked"
      | "degraded"
      | "disconnected"
      | "pending"
      | "provisioning"
      | "ready"
      | null;
    technicalStatus: "blocked" | "degraded" | "pending" | "ready";
    readinessReason: string;
    nextAction: string | null;
    firstIncompleteGate: {
      code: "billing" | "e2e" | "number" | "templates" | "webhooks";
      message: string;
      action: string;
    } | null;
  };
  capacity: {
    billingGate: {
      status: "blocked" | "failed" | "pending" | "ready";
      message: string;
      action: string;
    };
    creditCents: number;
    creditReserveCents: number | null;
    quotaConsumed: number;
    quotaReserved: number;
    quotaInFlight: number;
    monthlyQuota: number | null;
    circuit: {
      status: "closed" | "open";
      cause: string | null;
      reason: string;
      nextAction: string;
    };
    trafficStatus: "blocked" | "enabled" | "offboarded";
    trafficAllowed: boolean;
    trafficBlocker: { code: string; message: string } | null;
  };
};

export type ClinicSupervisionSummary = {
  clinic: ClinicSupervisionInput["clinic"];
  capacityMetrics: Pick<
    ClinicSupervisionInput["capacity"],
    | "creditCents"
    | "creditReserveCents"
    | "monthlyQuota"
    | "quotaConsumed"
    | "quotaInFlight"
    | "quotaReserved"
  >;
  messagingMode: "blocked" | "enabled" | "offboarded" | "synthetic-only";
  messagingModeReason: string;
  nextAction: ClinicSupervisionState | null;
  ownerName: string | null;
  states: ClinicSupervisionState[];
};

/** Presenta los estados actuales; los gates técnicos llegan del evaluador canónico. */
export function evaluateClinicSupervision(
  input: ClinicSupervisionInput,
): ClinicSupervisionSummary {
  const states = [
    ownerState(input.owner),
    subscriptionState(input.clinic.subscriptionStatus),
    connectionState(input.connection),
    capacityState(input.capacity),
  ];

  const messagingMode = getMessagingMode(input);
  const nextAction = states.find((state) => state.status !== "ready") ?? null;

  return {
    capacityMetrics: {
      creditCents: input.capacity.creditCents,
      creditReserveCents: input.capacity.creditReserveCents,
      monthlyQuota: input.capacity.monthlyQuota,
      quotaConsumed: input.capacity.quotaConsumed,
      quotaInFlight: input.capacity.quotaInFlight,
      quotaReserved: input.capacity.quotaReserved,
    },
    clinic: input.clinic,
    messagingMode,
    messagingModeReason:
      input.capacity.trafficBlocker?.message ??
      (messagingMode === "synthetic-only"
        ? "La capacidad está disponible para pruebas sintéticas; el tráfico real sigue bloqueado."
        : messagingMode === "offboarded"
          ? "La Conexión de WhatsApp fue retirada."
          : messagingMode === "blocked"
            ? "El tráfico real sigue sujeto a sus gates y a la habilitación explícita."
            : "La mensajería real está habilitada."),
    nextAction,
    ownerName: input.owner.name,
    states,
  };
}

function ownerState(
  owner: ClinicSupervisionInput["owner"],
): ClinicSupervisionState {
  if (owner.access === "ready") {
    return {
      action: null,
      cause: "El Médico propietario tiene acceso activo.",
      destination: "owner",
      key: "owner-access",
      label: "Acceso del Médico propietario",
      nextAction: "Sin acción requerida.",
      responsible: "Médico propietario",
      status: "ready",
      value: owner.name ?? "Acceso activo",
    };
  }

  if (owner.access === "pending") {
    const deliveryFailed = owner.invitationDelivery === "failed";
    return {
      action: owner.invitationCanRetry
        ? "retry-owner-invitation"
        : "wait-owner-acceptance",
      cause: deliveryFailed
        ? "Falló el último envío de la invitación del Médico propietario."
        : "La invitación del Médico propietario está pendiente de aceptación.",
      destination: "owner",
      key: "owner-access",
      label: "Acceso del Médico propietario",
      nextAction: owner.invitationCanRetry
        ? "Reenviar la invitación de acceso."
        : "El Médico propietario debe aceptar la invitación.",
      responsible: deliveryFailed
        ? "Equipo de identidad"
        : "Médico propietario",
      status: deliveryFailed ? "attention" : "pending",
      value: deliveryFailed
        ? "Invitación no entregada"
        : "Invitación pendiente",
    };
  }

  if (owner.invitationCanRetry) {
    return {
      action: "retry-owner-invitation",
      cause:
        owner.invitationDelivery === "failed"
          ? "Falló el último envío de la invitación del Médico propietario."
          : "La invitación del Médico propietario expiró antes de activar el acceso.",
      destination: "owner",
      key: "owner-access",
      label: "Acceso del Médico propietario",
      nextAction: "Reenviar la invitación de acceso.",
      responsible: "Equipo de identidad",
      status: "attention",
      value: "Invitación requiere reenvío",
    };
  }

  return {
    action: null,
    cause:
      "No hay acceso activo ni una invitación vigente para el Médico propietario.",
    destination: "owner",
    key: "owner-access",
    label: "Acceso del Médico propietario",
    nextAction: "Crear o enviar una invitación de acceso.",
    responsible: "Equipo de identidad",
    status: "blocked",
    value: "Sin acceso",
  };
}

function subscriptionState(
  subscriptionStatus: ClinicSupervisionInput["clinic"]["subscriptionStatus"],
): ClinicSupervisionState {
  if (subscriptionStatus === "active") {
    return {
      action: null,
      cause: "La suscripción está activa.",
      destination: "payments",
      key: "subscription",
      label: "Suscripción",
      nextAction: "Sin acción requerida.",
      responsible: "Equipo de pagos",
      status: "ready",
      value: "Activa",
    };
  }

  return {
    action: "activate-subscription",
    cause: "La suscripción está suspendida.",
    destination: "payments",
    key: "subscription",
    label: "Suscripción",
    nextAction: "Revisar el pago y activar la suscripción.",
    responsible: "Equipo de pagos",
    status: "blocked",
    value: "Suspendida",
  };
}

function connectionState(
  connection: ClinicSupervisionInput["connection"],
): ClinicSupervisionState {
  if (connection.status === null) {
    return {
      action: "configure-whatsapp",
      cause: "La Clínica todavía no tiene una Conexión de WhatsApp.",
      destination: "whatsapp",
      key: "whatsapp-connection",
      label: "Conexión de WhatsApp",
      nextAction: "Iniciar la activación de WhatsApp.",
      responsible: "Equipo de activación de WhatsApp",
      status: "pending",
      value: "Sin configurar",
    };
  }

  if (connection.status === "ready" && connection.technicalStatus === "ready") {
    return {
      action: null,
      cause: connection.readinessReason,
      destination: "whatsapp",
      key: "whatsapp-connection",
      label: "Conexión de WhatsApp",
      nextAction: "Sin acción requerida.",
      responsible: "Equipo de activación de WhatsApp",
      status: "ready",
      value: "Lista",
    };
  }

  const gate = connection.firstIncompleteGate;
  const status =
    connection.status === "blocked" ||
    connection.status === "disconnected" ||
    connection.technicalStatus === "blocked"
      ? "blocked"
      : connection.status === "degraded" ||
          connection.technicalStatus === "degraded" ||
          gate?.code === "number"
        ? "attention"
        : "pending";

  return {
    action: "open-whatsapp",
    cause: gate?.message ?? connection.readinessReason,
    destination: "whatsapp",
    key: "whatsapp-connection",
    label: "Conexión de WhatsApp",
    nextAction:
      gate?.action ??
      connection.nextAction ??
      "Revisar la Conexión de WhatsApp.",
    responsible:
      gate?.code === "billing"
        ? "Equipo de pagos"
        : "Equipo de activación de WhatsApp",
    status,
    value: {
      attention: "Requiere atención",
      blocked: "Bloqueada",
      pending: "Pendiente",
      ready: "Lista",
    }[status],
  };
}

function capacityState(
  capacity: ClinicSupervisionInput["capacity"],
): ClinicSupervisionState {
  if (capacity.circuit.status === "open") {
    const billingCause = isBillingCircuitCause(capacity.circuit.cause);
    return {
      action: billingCause ? "open-payments" : "open-whatsapp",
      cause: capacity.circuit.reason,
      destination: billingCause ? "payments" : "whatsapp",
      key: "messaging-capacity",
      label: "Capacidad de mensajería",
      nextAction: capacity.circuit.nextAction,
      responsible: billingCause
        ? "Equipo de pagos"
        : "Equipo de operaciones WhatsApp",
      status: "blocked",
      value: "Bloqueada",
    };
  }

  const { billingGate } = capacity;
  if (billingGate.status !== "ready") {
    const status: ClinicSupervisionStatus =
      billingGate.status === "failed"
        ? "attention"
        : billingGate.status === "blocked"
          ? "blocked"
          : "pending";
    return {
      action: "open-payments",
      cause: billingGate.message,
      destination: "payments",
      key: "messaging-capacity",
      label: "Capacidad de mensajería",
      nextAction: billingGate.action,
      responsible: "Equipo de pagos",
      status,
      value: {
        attention: "Verificación fallida",
        blocked: "No disponible",
        pending: "En verificación",
        ready: "Disponible",
      }[status],
    };
  }

  return {
    action: null,
    cause: billingGate.message,
    destination: "payments",
    key: "messaging-capacity",
    label: "Capacidad de mensajería",
    nextAction: "Sin acción requerida.",
    responsible: "Equipo de pagos",
    status: "ready",
    value: "Disponible",
  };
}

function getMessagingMode(
  input: ClinicSupervisionInput,
): ClinicSupervisionSummary["messagingMode"] {
  if (input.capacity.trafficStatus === "offboarded") return "offboarded";
  if (
    input.capacity.trafficStatus === "enabled" &&
    input.capacity.trafficAllowed
  ) {
    return "enabled";
  }
  if (input.clinic.isSynthetic) return "synthetic-only";
  return "blocked";
}

function isBillingCircuitCause(cause: string | null) {
  return cause === "credit-exhausted" || cause === "quota-exhausted";
}
