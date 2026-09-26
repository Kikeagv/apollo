import { CLINIC_TIMEZONE } from "~/clinic-timezone";

export const whatsappDeliveryStatuses = [
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
] as const;

export type WhatsAppDeliveryStatus = (typeof whatsappDeliveryStatuses)[number];

const whatsAppDeliveryStatusLabels: Record<WhatsAppDeliveryStatus, string> = {
  accepted: "aceptado",
  delivered: "entregado",
  failed: "fallido",
  read: "leído",
  sent: "enviado",
};

export function whatsAppDeliveryStatusLabel(status: WhatsAppDeliveryStatus) {
  return whatsAppDeliveryStatusLabels[status];
}

export type TransactionalWhatsAppRoute =
  | { kind: "text"; text: string }
  | { buttonLabel: string; kind: "interactive"; text: string }
  | {
      kind: "template";
      locale: string;
      name: string;
      parameters: string[];
      providerTemplateId: string;
    };

export type TransactionalWhatsAppTemplate = {
  category?: string | null;
  locale: string;
  name: string;
  parameters: string[];
  providerTemplateId: string | null;
  status?: string | null;
};

export class WhatsAppUtilityTemplateRequiredError extends Error {
  readonly retryable = false;

  constructor() {
    super("La Entrega transaccional necesita una plantilla Utility aprobada");
    this.name = "WhatsAppUtilityTemplateRequiredError";
  }
}

/** Exige una plantilla Utility aprobada para cada Entrega transaccional. */
export function chooseTransactionalWhatsAppRoute(input: {
  template: TransactionalWhatsAppTemplate;
  text: string;
}): TransactionalWhatsAppRoute {
  if (
    input.template.category !== "UTILITY" ||
    input.template.locale.trim() === "" ||
    input.template.name.trim() === "" ||
    input.template.status !== "APPROVED" ||
    input.template.providerTemplateId === null ||
    input.template.providerTemplateId.trim() === ""
  ) {
    throw new WhatsAppUtilityTemplateRequiredError();
  }

  return {
    kind: "template",
    locale: input.template.locale,
    name: input.template.name,
    parameters: [...input.template.parameters],
    providerTemplateId: input.template.providerTemplateId,
  };
}

/** Texto administrativo estable; no incorpora diagnóstico ni notas clínicas. */
export function formatTransactionalAppointmentText(input: {
  clinicName: string;
  doctorName?: string | null;
  kind: "cancellation" | "confirmation" | "reminder" | "reschedule";
  startsAt: Date;
}) {
  const startsAt = new Intl.DateTimeFormat("es-SV", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: CLINIC_TIMEZONE,
  }).format(input.startsAt);
  const doctor = input.doctorName?.trim();
  const doctorSuffix =
    doctor === undefined || doctor === "" ? "" : ` con ${doctor}`;
  if (input.kind === "cancellation") {
    return `La Clínica ${input.clinicName} canceló tu cita del ${startsAt}${doctorSuffix}.`;
  }
  if (input.kind === "confirmation") {
    return `La Clínica ${input.clinicName} confirmó tu cita del ${startsAt}${doctorSuffix}.`;
  }
  if (input.kind === "reschedule") {
    return `Tu cita en la Clínica ${input.clinicName} fue reprogramada para el ${startsAt}${doctorSuffix}.`;
  }
  return `Te recordamos tu cita en la Clínica ${input.clinicName} el ${startsAt}${doctorSuffix}.`;
}

/** Traduce variables del catálogo a valores administrativos congelables. */
export function buildTransactionalTemplateParameters(
  variables: readonly string[],
  input: {
    clinicName: string;
    doctorName?: string | null;
    patientName?: string | null;
    startsAt: Date;
  },
) {
  const date = new Intl.DateTimeFormat("es-SV", {
    dateStyle: "long",
    timeZone: CLINIC_TIMEZONE,
  }).format(input.startsAt);
  const time = new Intl.DateTimeFormat("es-SV", {
    timeStyle: "short",
    timeZone: CLINIC_TIMEZONE,
  }).format(input.startsAt);
  const values: Record<string, string> = {
    clinic: input.clinicName,
    clinic_name: input.clinicName,
    date,
    appointment_date: date,
    appointment_time: time,
    doctor: input.doctorName ?? "",
    doctor_name: input.doctorName ?? "",
    patient: input.patientName ?? "",
    patient_name: input.patientName ?? "",
    time,
  };
  return variables.map(
    (variable) => values[variable.trim().toLocaleLowerCase("es-SV")] ?? "",
  );
}

/** Aplica callbacks atrasados sin degradar el estado más avanzado observado. */
export function reconcileWhatsAppDeliveryStatus(
  current: WhatsAppDeliveryStatus | null,
  incoming: WhatsAppDeliveryStatus,
): WhatsAppDeliveryStatus {
  if (current === null) return incoming;
  if (current === "failed") return current;
  if (incoming === "failed") {
    return current === "delivered" || current === "read" ? current : incoming;
  }
  return deliveryStatusRank(incoming) > deliveryStatusRank(current)
    ? incoming
    : current;
}

/** Usa Retry-After cuando Kapso lo entrega y backoff exponencial en otro caso. */
export function retryAtFromKapsoHeaders(input: {
  attempt: number;
  headers: Headers;
  now: Date;
}): Date {
  const retryAfter = input.headers.get("Retry-After");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter.trim());
    if (Number.isFinite(seconds) && seconds >= 0) {
      return new Date(input.now.valueOf() + seconds * 1_000);
    }
    const retryAt = new Date(retryAfter);
    if (!Number.isNaN(retryAt.valueOf()) && retryAt >= input.now) {
      return retryAt;
    }
  }

  const normalizedAttempt = Math.max(1, Math.min(input.attempt, 7));
  const delay = Math.min(60 * 60_000, 60_000 * 2 ** (normalizedAttempt - 1));
  return new Date(input.now.valueOf() + delay);
}

function deliveryStatusRank(status: WhatsAppDeliveryStatus) {
  switch (status) {
    case "accepted":
      return 0;
    case "sent":
      return 1;
    case "delivered":
      return 2;
    case "read":
      return 3;
    case "failed":
      return -1;
  }
}
