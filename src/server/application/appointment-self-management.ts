export type AppointmentSelfManagementStore = {
  isAppointmentAuthor(input: {
    appointmentId: string;
    clinicId: string;
    contactId: string;
  }): Promise<boolean>;
};

export type AppointmentSelfManagementEscalation = {
  action: "cancel" | "reschedule";
  appointmentId: string;
  contact: { id: string; name: string };
  createdAt: Date;
  id: string;
  requestedStartsAt: Date | null;
};

export type AppointmentSelfManagementEscalationReader = {
  listSelfManagementEscalations(input: {
    clinicId: string;
    identityId: string;
  }): Promise<AppointmentSelfManagementEscalation[]>;
};

export type AppointmentSelfManagementEscalationResolver = {
  resolveSelfManagementEscalation(input: {
    clinicId: string;
    escalationId: string;
    identityId: string;
  }): Promise<boolean>;
};

export type AgendaAppointmentRescheduler = {
  rescheduleAppointment(input: {
    appointmentId: string;
    clinicId: string;
    contactId: string;
    now: Date;
    patientId: string;
    startsAt: Date;
  }): Promise<
    | { id: string; kind: "rescheduled"; startsAt: Date }
    | { kind: "unauthorized" }
    | { kind: "unavailable" }
  >;
};

export type AgendaAppointmentCanceller = {
  cancelAppointment(input: {
    appointmentId: string;
    clinicId: string;
    contactId: string;
    now: Date;
    patientId: string;
  }): Promise<
    | { id: string; kind: "cancelled" }
    | { kind: "unauthorized" }
    | { kind: "unavailable" }
  >;
};

const SELF_MANAGEMENT_WINDOW_MS = 12 * 60 * 60_000;

/** Determina si el Autor conserva autogestión antes del inicio de la Cita. */
export function canAuthorSelfManageAppointment(
  appointment: { authorContactId: string | null; startsAt: Date },
  contactId: string,
  now: Date,
) {
  return (
    appointment.authorContactId === contactId &&
    appointment.startsAt > now &&
    appointment.startsAt <= new Date(now.valueOf() + SELF_MANAGEMENT_WINDOW_MS)
  );
}

/** Autoriza autogestión únicamente al Contacto que confirmó la Reserva. */
export async function canContactManageAppointment(
  input: { appointmentId: string; clinicId: string; contactId: string },
  store: AppointmentSelfManagementStore,
) {
  return store.isAppointmentAuthor(input);
}

/** Consulta en Panacea las solicitudes que Asclepio no puede resolver solo. */
export async function listAppointmentSelfManagementEscalations(
  input: { clinicId: string; identityId: string },
  store: AppointmentSelfManagementEscalationReader,
) {
  return store.listSelfManagementEscalations(input);
}

/** Cierra la tarea humana y permite que Asclepio continúe la conversación. */
export async function resolveAppointmentSelfManagementEscalation(
  input: { clinicId: string; escalationId: string; identityId: string },
  store: AppointmentSelfManagementEscalationResolver,
) {
  return store.resolveSelfManagementEscalation(input);
}
