import type { AppointmentEventType } from "./manual-appointments";

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

export type PatientContactSelection =
  | { kind: "existing"; contactId: string }
  | { kind: "new"; name: string; phone: string };

export type PatientRegistration = {
  contact: Contact;
  link: ContactPatientLink;
  patient: Patient;
  reusedContact: boolean;
};

export type ContactPhoneMatch = Contact & {
  patientIds: string[];
};

export type PatientDirectoryEntry = Patient & {
  appointmentCount: number;
  contactCount: number;
};

export type ContactDirectoryEntry = Contact & {
  patientIds: string[];
  patientNames: string[];
};

export type PatientDirectory = {
  contacts: ContactDirectoryEntry[];
  patients: PatientDirectoryEntry[];
};

export type PatientSearchTarget = "contacts" | "patients";

export type ContactPatientRelationship = "contact" | "tutor";
export type GuardianshipVerificationStatus = "pending" | "verified";

export type PatientContactLinkDetail = {
  contact: Contact;
  guardianshipVerificationStatus: GuardianshipVerificationStatus | null;
  guardianDui: string | null;
  id: string;
  relationship: ContactPatientRelationship;
};

export type PatientAppointmentEvent = {
  actorClinicUserId: string | null;
  actorContactId: string | null;
  occurredAt: Date;
  reason: string | null;
  recipient: Contact | null;
  type: AppointmentEventType;
};

export type PatientAppointmentHistory = {
  doctor: { id: string; name: string };
  endsAt: Date;
  events: PatientAppointmentEvent[];
  id: string;
  origin: "manual" | "reservation" | null;
  service: { name: string };
  startsAt: Date;
  status: "confirmed" | "cancelled";
};

export type PatientAdministrativeDetail = {
  appointments: PatientAppointmentHistory[];
  contacts: PatientContactLinkDetail[];
  patient: Patient;
};

export type PendingGuardianshipVerification = {
  guardianDui: string;
  id: string;
  patient: Patient;
  tutor: Contact;
};

export type AdministrativeRecords = {
  contacts: Array<Contact & { patientIds: string[] }>;
  patients: Array<Patient & { contactIds: string[] }>;
};

export type AdministrativeRecordsStore = {
  addPatientContact(input: {
    clinicId: string;
    contact:
      | { contactId: string; kind: "existing" }
      | { kind: "new"; name: string; phoneE164: string };
    guardianDui: string | null;
    identityId: string;
    patientId: string;
    relationship: ContactPatientRelationship;
  }): Promise<PatientContactLinkDetail>;
  verifyPatientGuardianship(input: {
    clinicId: string;
    identityId: string;
    linkId: string;
  }): Promise<PatientContactLinkDetail | undefined>;
  findContactByPhone(input: {
    clinicId: string;
    identityId: string;
    phoneE164: string;
  }): Promise<ContactPhoneMatch | undefined>;
  getPatientAdministrativeDetail(input: {
    clinicId: string;
    identityId: string;
    patientId: string;
  }): Promise<PatientAdministrativeDetail | undefined>;
  listPatientDirectory(input: {
    clinicId: string;
    identityId: string;
    query: string;
    searchTarget: PatientSearchTarget;
  }): Promise<PatientDirectory>;
  registerPatient(input: {
    birthDate: string;
    clinicId: string;
    contact:
      | { contactId: string; kind: "existing" }
      | { kind: "new"; name: string; phoneE164: string };
    guardianDui: string | null;
    identityId: string;
    patientName: string;
    relationship: ContactPatientRelationship;
  }): Promise<PatientRegistration>;
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
  listPendingGuardianshipVerifications(input: {
    clinicId: string;
    identityId: string;
  }): Promise<PendingGuardianshipVerification[]>;
};

/** Agrega un Contacto o Tutor sin convertirlo en principal de dominio. */
export async function addPatientContact(
  input: {
    clinicId: string;
    contact: PatientContactSelection;
    guardianDui?: string;
    identityId: string;
    patientId: string;
    relationship?: ContactPatientRelationship;
  },
  store: Pick<AdministrativeRecordsStore, "addPatientContact">,
) {
  const { guardianDui, relationship } = normalizePatientLink(
    input.relationship,
    input.guardianDui,
  );
  return store.addPatientContact({
    clinicId: input.clinicId,
    contact:
      input.contact.kind === "existing"
        ? input.contact
        : {
            kind: "new",
            name: requiredName(input.contact.name),
            phoneE164: normalizeE164Phone(input.contact.phone),
          },
    guardianDui,
    identityId: input.identityId,
    patientId: input.patientId,
    relationship,
  });
}

/** Confirma la tutela pendiente sin borrar el Vínculo ni su evidencia administrativa. */
export async function verifyPatientGuardianship(
  input: { clinicId: string; identityId: string; linkId: string },
  store: Pick<AdministrativeRecordsStore, "verifyPatientGuardianship">,
) {
  return store.verifyPatientGuardianship(input);
}

/** Lista Pacientes o Contactos según la tarea de búsqueda del operador. */
export async function listPatientDirectory(
  input: {
    clinicId: string;
    identityId: string;
    query?: string;
    searchTarget?: PatientSearchTarget;
  },
  store: Pick<AdministrativeRecordsStore, "listPatientDirectory">,
) {
  return store.listPatientDirectory({
    clinicId: input.clinicId,
    identityId: input.identityId,
    query: input.query?.trim() ?? "",
    searchTarget: input.searchTarget ?? "patients",
  });
}

/** Consulta la ficha administrativa sin incorporar datos clínicos o conversaciones. */
export async function getPatientAdministrativeDetail(
  input: { clinicId: string; identityId: string; patientId: string },
  store: Pick<AdministrativeRecordsStore, "getPatientAdministrativeDetail">,
) {
  return store.getPatientAdministrativeDetail(input);
}

/** Busca un Contacto por su teléfono normalizado antes de confirmar su reutilización. */
export async function findContactByPhone(
  input: { clinicId: string; identityId: string; phone: string },
  store: Pick<AdministrativeRecordsStore, "findContactByPhone">,
) {
  return store.findContactByPhone({
    clinicId: input.clinicId,
    identityId: input.identityId,
    phoneE164: normalizeE164Phone(input.phone),
  });
}

/** Registra una ficha de Paciente y resuelve su Contacto inicial atómicamente. */
export async function registerPatient(
  input: {
    birthDate: string;
    clinicId: string;
    contact: PatientContactSelection;
    guardianDui?: string;
    identityId: string;
    patientName: string;
    relationship?: ContactPatientRelationship;
  },
  store: Pick<AdministrativeRecordsStore, "registerPatient">,
) {
  const { guardianDui, relationship } = normalizePatientLink(
    input.relationship,
    input.guardianDui,
  );
  const patientName = requiredName(input.patientName);
  return store.registerPatient({
    birthDate: validBirthDate(input.birthDate),
    clinicId: input.clinicId,
    contact:
      input.contact.kind === "existing"
        ? input.contact
        : {
            kind: "new",
            name:
              relationship === "contact"
                ? patientName
                : requiredName(input.contact.name),
            phoneE164: normalizeE164Phone(input.contact.phone),
          },
    guardianDui,
    identityId: input.identityId,
    patientName,
    relationship,
  });
}

/** Crea explícitamente una Ficha de Paciente sin inventar un Contacto. */
export async function createIncompletePatient(
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

/** Lista las tutelas que la Clínica debe verificar antes de su primera visita. */
export async function listPendingGuardianshipVerifications(
  input: { clinicId: string; identityId: string },
  store: Pick<
    AdministrativeRecordsStore,
    "listPendingGuardianshipVerifications"
  >,
) {
  return store.listPendingGuardianshipVerifications(input);
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

function validGuardianDui(value: string | undefined) {
  const normalized = value?.trim();
  if (normalized === undefined || !/^\d{8}-\d$/.test(normalized)) {
    throw new Error("El DUI del Tutor debe usar el formato ########-#");
  }
  return normalized;
}

function normalizePatientLink(
  relationship: ContactPatientRelationship | undefined,
  guardianDui: string | undefined,
) {
  const normalizedRelationship = relationship ?? "contact";
  if (normalizedRelationship !== "tutor" && guardianDui !== undefined) {
    throw new Error("Solo una tutela puede incluir el DUI del Tutor");
  }
  return {
    guardianDui:
      normalizedRelationship === "tutor" ? validGuardianDui(guardianDui) : null,
    relationship: normalizedRelationship,
  };
}
