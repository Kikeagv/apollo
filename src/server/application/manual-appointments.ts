export type ManualAppointment = {
  id: string;
  startsAt: Date;
  transactionalMessage?: ManualAppointmentTransactionalMessage;
};

/** Vocabulario compartido por el historial de Citas y sus consumidores. */
export const appointmentEventTypes = [
  "manual-created",
  "cancelled",
  "manual-confirmation-sent",
  "manual-confirmation-failed",
  "manual-cancellation-sent",
  "manual-cancellation-failed",
] as const;

export type AppointmentEventType = (typeof appointmentEventTypes)[number];

export type ManualAppointmentFormData = {
  offers: {
    doctorId: string;
    doctorName: string;
    serviceName: string;
    serviceOfferId: string;
  }[];
  patients: {
    contacts: ManualAppointmentContact[];
    id: string;
    name: string;
  }[];
};

export type ManualAppointmentContact = {
  id: string;
  name: string;
  phoneE164: string;
};

/** Contrato seguro para cliente de una Cita que Panacea puede consultar. */
export type AgendaAppointment = {
  bufferMinutes: number | null;
  contacts: ManualAppointmentContact[];
  doctor: { id: string; name: string };
  durationMinutes: number | null;
  endsAt: Date;
  events: {
    actorClinicUserId: string;
    occurredAt: Date;
    recipient: ManualAppointmentContact | null;
    reason: string | null;
    type: AppointmentEventType;
  }[];
  id: string;
  origin: "manual" | "reservation" | null;
  outsideSchedule: boolean;
  patient: { id: string; name: string };
  priceUsd: string | null;
  service: { name: string };
  startsAt: Date;
  status: "confirmed" | "cancelled";
};

export type ManualAppointmentMessageType =
  "manual-confirmation" | "manual-cancellation";

export type ManualAppointmentTransactionalMessage = {
  appointmentId: string;
  clinicId: string;
  recipient: { id: string; name: string; phoneE164: string };
  type: ManualAppointmentMessageType;
};

export type ManualAppointmentMessageSender = {
  send(message: ManualAppointmentTransactionalMessage): Promise<void>;
};

export type ManualAppointmentMessageDeliveryRecorder = {
  recordMessageDelivery(input: {
    actorIdentityId: string;
    appointmentId: string;
    clinicId: string;
    recipientContactId: string;
    result: "sent" | "failed";
    type: ManualAppointmentMessageType;
  }): Promise<void>;
};

export type ManualAppointmentOutsideScheduleConfirmation = {
  requiresOutsideScheduleConfirmation: true;
};

export type ManualAppointmentCreator = {
  create(
    input: CreateManualAppointmentInput,
  ): Promise<
    ManualAppointment | ManualAppointmentOutsideScheduleConfirmation | undefined
  >;
};

export type ManualAppointmentCanceller = {
  cancel(input: {
    appointmentId: string;
    clinicId: string;
    identityId: string;
    now: Date;
    notificationRecipientContactId?: string;
    reason: string | null;
  }): Promise<
    | ({ id: string; status: "cancelled" } & Partial<ManualAppointment>)
    | undefined
  >;
};

export type ManualAppointmentReader = {
  listAppointments(input: {
    clinicId: string;
    identityId: string;
    status: "confirmed" | "cancelled";
  }): Promise<AgendaAppointment[]>;
  listFormData(input: {
    clinicId: string;
    identityId: string;
  }): Promise<ManualAppointmentFormData>;
};

export class ManualAppointmentUnavailableError extends Error {
  constructor() {
    super("La Cita manual ya no es una Opción de atención autorizada");
    this.name = "ManualAppointmentUnavailableError";
  }
}

export class ManualAppointmentOutsideScheduleConfirmationRequiredError extends Error {
  constructor() {
    super(
      "La Cita manual no cabe en el Horario vigente; confirme crearla fuera de horario",
    );
    this.name = "ManualAppointmentOutsideScheduleConfirmationRequiredError";
  }
}

export class ManualAppointmentNotCancellableError extends Error {
  constructor() {
    super(
      "La Cita manual no puede cancelarse porque ya inició, pasó o no existe",
    );
    this.name = "ManualAppointmentNotCancellableError";
  }
}

export type CreateManualAppointmentInput = {
  clinicId: string;
  doctorId: string;
  identityId: string;
  patientId: string;
  serviceOfferId: string;
  startsAt: Date;
  outsideScheduleConfirmed?: boolean;
  notificationRecipientContactId?: string;
};

/** Registra una Cita manual después de que la Agenda autoriza su capacidad. */
export async function createManualAppointment(
  input: CreateManualAppointmentInput,
  store: ManualAppointmentCreator &
    Partial<ManualAppointmentMessageDeliveryRecorder>,
  now = new Date(),
  messageSender?: ManualAppointmentMessageSender,
) {
  if (input.startsAt <= now) {
    throw new Error("La Cita manual debe iniciar en el futuro");
  }
  if (input.startsAt.getUTCMinutes() % 5 !== 0) {
    throw new Error(
      "La Cita manual debe iniciar en la cuadrícula de cinco minutos",
    );
  }
  const appointment = await store.create(input);
  if (appointment === undefined) throw new ManualAppointmentUnavailableError();
  if ("requiresOutsideScheduleConfirmation" in appointment) {
    throw new ManualAppointmentOutsideScheduleConfirmationRequiredError();
  }
  await deliverTransactionalMessage(
    appointment,
    input.identityId,
    store,
    messageSender,
  );
  return appointment;
}

/** Cancela una Cita manual futura, conserva su historial y libera su capacidad. */
export async function cancelManualAppointment(
  input: {
    appointmentId: string;
    clinicId: string;
    identityId: string;
    notificationRecipientContactId?: string;
    reason?: string;
  },
  store: ManualAppointmentCanceller &
    Partial<ManualAppointmentMessageDeliveryRecorder>,
  now = new Date(),
  messageSender?: ManualAppointmentMessageSender,
) {
  const appointment = await store.cancel({
    ...input,
    now,
    reason: optionalReason(input.reason),
  });
  if (appointment === undefined)
    throw new ManualAppointmentNotCancellableError();
  await deliverTransactionalMessage(
    appointment,
    input.identityId,
    store,
    messageSender,
  );
  return appointment;
}

/** Consulta los Pacientes y Ofertas disponibles para registrar una Cita manual. */
export async function listManualAppointmentFormData(
  input: { clinicId: string; identityId: string },
  store: Pick<ManualAppointmentReader, "listFormData">,
) {
  return store.listFormData(input);
}

/** Consulta las Citas activas que el Calendario de Panacea muestra. */
export async function listManualAppointments(
  input: { clinicId: string; identityId: string },
  store: Pick<ManualAppointmentReader, "listAppointments">,
) {
  return store.listAppointments({ ...input, status: "confirmed" });
}

/** Consulta las Citas manuales canceladas para detalle y ficha administrativa. */
export async function listCancelledManualAppointments(
  input: { clinicId: string; identityId: string },
  store: Pick<ManualAppointmentReader, "listAppointments">,
) {
  return store.listAppointments({ ...input, status: "cancelled" });
}

async function deliverTransactionalMessage(
  appointment: Partial<ManualAppointment>,
  actorIdentityId: string,
  store:
    | (ManualAppointmentCreator &
        Partial<ManualAppointmentMessageDeliveryRecorder>)
    | (ManualAppointmentCanceller &
        Partial<ManualAppointmentMessageDeliveryRecorder>),
  messageSender: ManualAppointmentMessageSender | undefined,
) {
  if (appointment.transactionalMessage === undefined) return;
  if (messageSender === undefined || !hasMessageDeliveryRecorder(store)) {
    throw new Error(
      "No se configuró el envío de Mensajes transaccionales de Cita",
    );
  }
  let result: "sent" | "failed" = "sent";
  try {
    await messageSender.send(appointment.transactionalMessage);
  } catch {
    result = "failed";
  }
  await store.recordMessageDelivery({
    actorIdentityId,
    appointmentId: appointment.transactionalMessage.appointmentId,
    clinicId: appointment.transactionalMessage.clinicId,
    recipientContactId: appointment.transactionalMessage.recipient.id,
    result,
    type: appointment.transactionalMessage.type,
  });
}

function hasMessageDeliveryRecorder(
  store:
    | (ManualAppointmentCreator &
        Partial<ManualAppointmentMessageDeliveryRecorder>)
    | (ManualAppointmentCanceller &
        Partial<ManualAppointmentMessageDeliveryRecorder>),
): store is
  | (ManualAppointmentCreator & ManualAppointmentMessageDeliveryRecorder)
  | (ManualAppointmentCanceller & ManualAppointmentMessageDeliveryRecorder) {
  return "recordMessageDelivery" in store;
}

function optionalReason(value: string | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (normalized === undefined || normalized.length === 0) return null;
  if (normalized.length > 500) {
    throw new Error("La razón de cancelación no puede exceder 500 caracteres");
  }
  return normalized;
}
