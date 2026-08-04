export type DoctorSummary = {
  active: boolean;
  id: string;
  primarySpecialty: string | null;
  publicName: string | null;
};

export type DoctorDeactivator = {
  deactivate(input: {
    clinicId: string;
    doctorId: string;
    identityId: string;
  }): Promise<(DoctorSummary & { active: false }) | undefined>;
};

export class DoctorDeactivationAccessError extends Error {
  constructor() {
    super("Solo el Médico propietario puede desactivar este Médico");
    this.name = "DoctorDeactivationAccessError";
  }
}

/** Cierra un Médico para Opciones nuevas y conserva su perfil histórico. */
export async function deactivateDoctor(
  input: { clinicId: string; doctorId: string; identityId: string },
  store: DoctorDeactivator,
) {
  const doctor = await store.deactivate(input);
  if (doctor === undefined) throw new DoctorDeactivationAccessError();
  return doctor;
}
