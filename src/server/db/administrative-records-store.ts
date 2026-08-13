import { and, asc, eq, ne } from "drizzle-orm";

import { type AdministrativeRecordsStore } from "~/server/application/administrative-records";
import { inClinicTransaction } from "~/server/db/clinic-context";
import { contactPatientLinks, contacts, patients } from "~/server/db/schema";

export class ContactPhoneConflictError extends Error {
  constructor() {
    super("Ya existe un Contacto con ese teléfono en la Clínica");
    this.name = "ContactPhoneConflictError";
  }
}

export class ContactPatientLinkConflictError extends Error {
  constructor() {
    super("El Contacto ya está vinculado con ese Paciente");
    this.name = "ContactPatientLinkConflictError";
  }
}

export class AdministrativeRecordNotFoundError extends Error {
  constructor() {
    super("La ficha administrativa no existe en la Clínica");
    this.name = "AdministrativeRecordNotFoundError";
  }
}

export const drizzleAdministrativeRecordsStore: AdministrativeRecordsStore = {
  async register(input) {
    return inClinicTransaction(input, async (transaction) => {
      const existing = await transaction.query.contacts.findFirst({
        columns: { id: true },
        where: and(
          eq(contacts.clinicId, input.clinicId),
          eq(contacts.phoneE164, input.phoneE164),
        ),
      });
      if (existing !== undefined) throw new ContactPhoneConflictError();

      const [contact] = await transaction
        .insert(contacts)
        .values({
          clinicId: input.clinicId,
          name: input.contactName,
          phoneE164: input.phoneE164,
        })
        .returning(contactFields);
      if (contact === undefined)
        throw new Error("No se pudo crear el Contacto");

      const [patient] = await transaction
        .insert(patients)
        .values({
          birthDate: input.birthDate,
          clinicId: input.clinicId,
          name: input.patientName,
        })
        .returning(patientFields);
      if (patient === undefined)
        throw new Error("No se pudo crear el Paciente");

      const [link] = await transaction
        .insert(contactPatientLinks)
        .values({
          clinicId: input.clinicId,
          contactId: contact.id,
          patientId: patient.id,
        })
        .returning(linkFields);
      if (link === undefined) throw new Error("No se pudo crear el Vínculo");

      return { contact, link, patient };
    });
  },

  async createContact(input) {
    return inClinicTransaction(input, async (transaction) => {
      const existing = await transaction.query.contacts.findFirst({
        columns: { id: true },
        where: and(
          eq(contacts.clinicId, input.clinicId),
          eq(contacts.phoneE164, input.phoneE164),
        ),
      });
      if (existing !== undefined) throw new ContactPhoneConflictError();

      const [contact] = await transaction
        .insert(contacts)
        .values({
          clinicId: input.clinicId,
          name: input.name,
          phoneE164: input.phoneE164,
        })
        .returning(contactFields);
      if (contact === undefined)
        throw new Error("No se pudo crear el Contacto");
      return contact;
    });
  },

  async updateContact(input) {
    return inClinicTransaction(input, async (transaction) => {
      const contact = await transaction.query.contacts.findFirst({
        columns: { id: true },
        where: and(
          eq(contacts.clinicId, input.clinicId),
          eq(contacts.id, input.id),
        ),
      });
      if (contact === undefined) throw new AdministrativeRecordNotFoundError();
      const duplicate = await transaction.query.contacts.findFirst({
        columns: { id: true },
        where: and(
          eq(contacts.clinicId, input.clinicId),
          eq(contacts.phoneE164, input.phoneE164),
          ne(contacts.id, input.id),
        ),
      });
      if (duplicate !== undefined) throw new ContactPhoneConflictError();

      const [updated] = await transaction
        .update(contacts)
        .set({ name: input.name, phoneE164: input.phoneE164 })
        .where(eq(contacts.id, input.id))
        .returning(contactFields);
      if (updated === undefined) throw new AdministrativeRecordNotFoundError();
      return updated;
    });
  },

  async createPatient(input) {
    return inClinicTransaction(input, async (transaction) => {
      const [patient] = await transaction
        .insert(patients)
        .values({
          birthDate: input.birthDate,
          clinicId: input.clinicId,
          name: input.name,
        })
        .returning(patientFields);
      if (patient === undefined)
        throw new Error("No se pudo crear el Paciente");
      return patient;
    });
  },

  async updatePatient(input) {
    return inClinicTransaction(input, async (transaction) => {
      const [updated] = await transaction
        .update(patients)
        .set({ birthDate: input.birthDate, name: input.name })
        .where(
          and(eq(patients.clinicId, input.clinicId), eq(patients.id, input.id)),
        )
        .returning(patientFields);
      if (updated === undefined) throw new AdministrativeRecordNotFoundError();
      return updated;
    });
  },

  async createContactPatientLink(input) {
    return inClinicTransaction(input, async (transaction) => {
      const [contact, patient] = await Promise.all([
        transaction.query.contacts.findFirst({
          columns: { id: true },
          where: and(
            eq(contacts.clinicId, input.clinicId),
            eq(contacts.id, input.contactId),
          ),
        }),
        transaction.query.patients.findFirst({
          columns: { id: true },
          where: and(
            eq(patients.clinicId, input.clinicId),
            eq(patients.id, input.patientId),
          ),
        }),
      ]);
      if (contact === undefined || patient === undefined) {
        throw new AdministrativeRecordNotFoundError();
      }
      const existing = await transaction.query.contactPatientLinks.findFirst({
        columns: { id: true },
        where: and(
          eq(contactPatientLinks.contactId, input.contactId),
          eq(contactPatientLinks.patientId, input.patientId),
        ),
      });
      if (existing !== undefined) throw new ContactPatientLinkConflictError();

      const [link] = await transaction
        .insert(contactPatientLinks)
        .values({
          clinicId: input.clinicId,
          contactId: input.contactId,
          patientId: input.patientId,
        })
        .returning(linkFields);
      if (link === undefined) throw new Error("No se pudo crear el Vínculo");
      return link;
    });
  },

  async list(input) {
    return inClinicTransaction(input, async (transaction) => {
      const [clinicContacts, clinicPatients, links] = await Promise.all([
        transaction.query.contacts.findMany({
          columns: { id: true, name: true, phoneE164: true },
          orderBy: [asc(contacts.name), asc(contacts.id)],
          where: eq(contacts.clinicId, input.clinicId),
        }),
        transaction.query.patients.findMany({
          columns: { birthDate: true, id: true, name: true },
          orderBy: [asc(patients.name), asc(patients.id)],
          where: eq(patients.clinicId, input.clinicId),
        }),
        transaction.query.contactPatientLinks.findMany({
          columns: { contactId: true, id: true, patientId: true },
          where: eq(contactPatientLinks.clinicId, input.clinicId),
        }),
      ]);
      const patientIdsByContact = new Map<string, string[]>();
      const contactIdsByPatient = new Map<string, string[]>();
      for (const link of links) {
        patientIdsByContact.set(link.contactId, [
          ...(patientIdsByContact.get(link.contactId) ?? []),
          link.patientId,
        ]);
        contactIdsByPatient.set(link.patientId, [
          ...(contactIdsByPatient.get(link.patientId) ?? []),
          link.contactId,
        ]);
      }
      return {
        contacts: clinicContacts.map((contact) => ({
          ...contact,
          patientIds: patientIdsByContact.get(contact.id) ?? [],
        })),
        patients: clinicPatients.map((patient) => ({
          ...patient,
          contactIds: contactIdsByPatient.get(patient.id) ?? [],
        })),
      };
    });
  },

  async listPendingGuardianshipVerifications(input) {
    return inClinicTransaction(input, async (transaction) => {
      const tasks = await transaction
        .select({
          guardianDui: contactPatientLinks.guardianDui,
          id: contactPatientLinks.id,
          patientBirthDate: patients.birthDate,
          patientId: patients.id,
          patientName: patients.name,
          tutorId: contacts.id,
          tutorName: contacts.name,
          tutorPhoneE164: contacts.phoneE164,
        })
        .from(contactPatientLinks)
        .innerJoin(
          patients,
          and(
            eq(contactPatientLinks.clinicId, patients.clinicId),
            eq(contactPatientLinks.patientId, patients.id),
          ),
        )
        .innerJoin(
          contacts,
          and(
            eq(contactPatientLinks.clinicId, contacts.clinicId),
            eq(contactPatientLinks.contactId, contacts.id),
          ),
        )
        .where(
          and(
            eq(contactPatientLinks.clinicId, input.clinicId),
            eq(contactPatientLinks.relationship, "tutor"),
            eq(contactPatientLinks.guardianshipVerificationStatus, "pending"),
          ),
        )
        .orderBy(asc(patients.name), asc(contactPatientLinks.id));
      return tasks.flatMap((task) =>
        task.guardianDui === null || task.patientBirthDate === null
          ? []
          : [
              {
                guardianDui: task.guardianDui,
                id: task.id,
                patient: {
                  birthDate: task.patientBirthDate,
                  id: task.patientId,
                  name: task.patientName,
                },
                tutor: {
                  id: task.tutorId,
                  name: task.tutorName,
                  phoneE164: task.tutorPhoneE164,
                },
              },
            ],
      );
    });
  },
};

const contactFields = {
  id: contacts.id,
  name: contacts.name,
  phoneE164: contacts.phoneE164,
};

const patientFields = {
  birthDate: patients.birthDate,
  id: patients.id,
  name: patients.name,
};

const linkFields = {
  contactId: contactPatientLinks.contactId,
  id: contactPatientLinks.id,
  patientId: contactPatientLinks.patientId,
};
