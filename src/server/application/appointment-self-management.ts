export type AppointmentSelfManagementStore = {
  isAppointmentAuthor(input: {
    appointmentId: string;
    clinicId: string;
    contactId: string;
  }): Promise<boolean>;
};

/** Autoriza autogestión únicamente al Contacto que confirmó la Reserva. */
export async function canContactManageAppointment(
  input: { appointmentId: string; clinicId: string; contactId: string },
  store: AppointmentSelfManagementStore,
) {
  return store.isAppointmentAuthor(input);
}
