export type ManualAppointment = {
  id: string;
  startsAt: Date;
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

export type CreateManualAppointmentInput = {
  clinicId: string;
  doctorId: string;
  identityId: string;
  patientId: string;
  serviceOfferId: string;
  startsAt: Date;
  outsideScheduleConfirmed?: boolean;
};

/** Registra una Cita manual después de que la Agenda autoriza su capacidad. */
export async function createManualAppointment(
  input: CreateManualAppointmentInput,
  store: ManualAppointmentCreator,
  now = new Date(),
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
  return appointment;
}
