const MAX_RECORD_NAME_LENGTH = 120;

export type Contact = {
  id: string;
  name: string;
  phoneE164: string;
};

export type Patient = {
  birthDate: string | null;
  id: string;
  name: string;
};

export type ContactPatientLink = {
  contactId: string;
  id: string;
  patientId: string;
};

export type AdministrativeRecords = {
  contacts: Array<Contact & { patientIds: string[] }>;
  patients: Array<Patient & { contactIds: string[] }>;
};

export type AdministrativeRecordsStore = {
  register(input: {
    birthDate: string;
    clinicId: string;
    contactName: string;
    identityId: string;
    patientName: string;
    phoneE164: string;
  }): Promise<{
    contact: Contact;
    link: ContactPatientLink;
    patient: Patient;
  }>;
  createContact(input: {
    clinicId: string;
    identityId: string;
    name: string;
    phoneE164: string;
  }): Promise<Contact>;
  createContactPatientLink(input: {
    clinicId: string;
    contactId: string;
    identityId: string;
    patientId: string;
  }): Promise<ContactPatientLink>;
  createPatient(input: {
    birthDate: string;
    clinicId: string;
    identityId: string;
    name: string;
  }): Promise<Patient>;
  updateContact(input: {
    clinicId: string;
    id: string;
    identityId: string;
    name: string;
    phoneE164: string;
  }): Promise<Contact>;
  updatePatient(input: {
    birthDate: string;
    clinicId: string;
    id: string;
    identityId: string;
    name: string;
  }): Promise<Patient>;
  list(input: {
    clinicId: string;
    identityId: string;
  }): Promise<AdministrativeRecords>;
};

/** Registra un Contacto administrativo identificado por su teléfono dentro de la Clínica. */
export async function createContact(
  input: {
    clinicId: string;
    identityId: string;
    name: string;
    phone: string;
  },
  store: Pick<AdministrativeRecordsStore, "createContact">,
) {
  return store.createContact({
    clinicId: input.clinicId,
    identityId: input.identityId,
    name: requiredName(input.name),
    phoneE164: normalizeE164Phone(input.phone),
  });
}

/** Actualiza el nombre y teléfono administrativo de un Contacto existente. */
export async function updateContact(
  input: {
    clinicId: string;
    id: string;
    identityId: string;
    name: string;
    phone: string;
  },
  store: Pick<AdministrativeRecordsStore, "updateContact">,
) {
  return store.updateContact({
    clinicId: input.clinicId,
    id: input.id,
    identityId: input.identityId,
    name: requiredName(input.name),
    phoneE164: normalizeE164Phone(input.phone),
  });
}

/** Crea la ficha administrativa de un Paciente dentro de la Clínica. */
export async function createPatient(
  input: {
    birthDate: string;
    clinicId: string;
    identityId: string;
    name: string;
  },
  store: Pick<AdministrativeRecordsStore, "createPatient">,
) {
  return store.createPatient({
    birthDate: validBirthDate(input.birthDate),
    clinicId: input.clinicId,
    identityId: input.identityId,
    name: requiredName(input.name),
  });
}

/** Edita la ficha administrativa de un Paciente sin cambiar su identidad. */
export async function updatePatient(
  input: {
    birthDate: string;
    clinicId: string;
    id: string;
    identityId: string;
    name: string;
  },
  store: Pick<AdministrativeRecordsStore, "updatePatient">,
) {
  return store.updatePatient({
    birthDate: validBirthDate(input.birthDate),
    clinicId: input.clinicId,
    id: input.id,
    identityId: input.identityId,
    name: requiredName(input.name),
  });
}

/** Registra la relación explícita entre un Contacto y un Paciente de la Clínica. */
export async function createContactPatientLink(
  input: {
    clinicId: string;
    contactId: string;
    identityId: string;
    patientId: string;
  },
  store: Pick<AdministrativeRecordsStore, "createContactPatientLink">,
) {
  return store.createContactPatientLink(input);
}

/** Registra las fichas y el Vínculo que una Cita manual necesita en una sola operación. */
export async function registerAdministrativeRecordsForManualAppointment(
  input: {
    birthDate: string;
    clinicId: string;
    contactName: string;
    identityId: string;
    patientName: string;
    phone: string;
  },
  store: Pick<AdministrativeRecordsStore, "register">,
) {
  return store.register({
    birthDate: validBirthDate(input.birthDate),
    clinicId: input.clinicId,
    contactName: requiredName(input.contactName),
    identityId: input.identityId,
    patientName: requiredName(input.patientName),
    phoneE164: normalizeE164Phone(input.phone),
  });
}

/** Lista las fichas de la Clínica con sus Vínculos explícitos. */
export async function listAdministrativeRecords(
  input: { clinicId: string; identityId: string },
  store: Pick<AdministrativeRecordsStore, "list">,
) {
  return store.list(input);
}

function requiredName(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) throw new Error("El nombre es obligatorio");
  if (normalized.length > MAX_RECORD_NAME_LENGTH) {
    throw new Error(
      `El nombre no puede exceder ${MAX_RECORD_NAME_LENGTH} caracteres`,
    );
  }
  return normalized;
}

function normalizeE164Phone(value: string) {
  const normalized = value.trim().replace(/[()\s.-]/g, "");
  if (!/^\+[1-9]\d{1,14}$/.test(normalized)) {
    throw new Error("El teléfono debe ser un número E.164 válido");
  }
  return normalized;
}

function validBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("La fecha de nacimiento debe usar el formato AAAA-MM-DD");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("La fecha de nacimiento no es válida");
  }
  if (date.valueOf() > Date.now()) {
    throw new Error("La fecha de nacimiento no puede estar en el futuro");
  }
  return value;
}
