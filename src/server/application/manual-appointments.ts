export type ManualAppointment = {
  id: string;
  startsAt: Date;
};

export type ManualAppointmentCreator = {
  create(
    input: CreateManualAppointmentInput,
  ): Promise<ManualAppointment | undefined>;
};

export class ManualAppointmentUnavailableError extends Error {
  constructor() {
    super("La Cita manual ya no es una Opción de atención autorizada");
    this.name = "ManualAppointmentUnavailableError";
  }
}

export type CreateManualAppointmentInput = {
  clinicId: string;
  doctorId: string;
  identityId: string;
  patientId: string;
  serviceOfferId: string;
  startsAt: Date;
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
  return appointment;
}
