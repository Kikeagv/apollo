import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import {
  type AdministrativeRecordsStore,
  type ContactPatientRelationship,
  type GuardianshipVerificationStatus,
} from "~/server/application/administrative-records";
import { inClinicTransaction } from "~/server/db/clinic-context";
import type { db } from "~/server/db";
import {
  appointments,
  appointmentEvents,
  contactPatientLinks,
  contacts,
  doctors,
  patients,
  serviceOffers,
  services,
} from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

export class TutorOnlyForMinorPatientError extends Error {
  constructor() {
    super("Solo un Paciente menor de edad puede tener un Tutor");
    this.name = "TutorOnlyForMinorPatientError";
  }
}

export const drizzleAdministrativeRecordsStore: AdministrativeRecordsStore = {
  async verifyPatientGuardianship(input) {
    return inClinicTransaction(input, async (transaction) => {
      const [verified] = await transaction
        .update(contactPatientLinks)
        .set({ guardianshipVerificationStatus: "verified" })
        .where(
          and(
            eq(contactPatientLinks.clinicId, input.clinicId),
            eq(contactPatientLinks.id, input.linkId),
            eq(contactPatientLinks.relationship, "tutor"),
            eq(contactPatientLinks.guardianshipVerificationStatus, "pending"),
          ),
        )
        .returning({
          contactId: contactPatientLinks.contactId,
          guardianshipVerificationStatus:
            contactPatientLinks.guardianshipVerificationStatus,
          guardianDui: contactPatientLinks.guardianDui,
          id: contactPatientLinks.id,
          relationship: contactPatientLinks.relationship,
        });
      if (verified === undefined) return undefined;
      const contact = await transaction.query.contacts.findFirst({
        columns: { id: true, name: true, phoneE164: true },
        where: and(
          eq(contacts.clinicId, input.clinicId),
          eq(contacts.id, verified.contactId),
        ),
      });
      if (contact === undefined) throw new AdministrativeRecordNotFoundError();
      return toPatientContactLink({
        contactId: contact.id,
        contactName: contact.name,
        contactPhoneE164: contact.phoneE164,
        guardianshipVerificationStatus: verified.guardianshipVerificationStatus,
        guardianDui: verified.guardianDui,
        id: verified.id,
        relationship: verified.relationship,
      });
    });
  },

  async addPatientContact(input) {
    return inClinicTransaction(input, async (transaction) => {
      const patient = await transaction.query.patients.findFirst({
        columns: { birthDate: true, id: true },
        where: and(
          eq(patients.clinicId, input.clinicId),
          eq(patients.id, input.patientId),
        ),
      });
      if (patient === undefined) throw new AdministrativeRecordNotFoundError();
      if (
        input.relationship === "tutor" &&
        (patient.birthDate === null || !isMinor(patient.birthDate))
      ) {
        throw new TutorOnlyForMinorPatientError();
      }

      let contact: ContactRow | undefined;
      if (input.contact.kind === "existing") {
        contact = await transaction.query.contacts.findFirst({
          columns: { id: true, name: true, phoneE164: true },
          where: and(
            eq(contacts.clinicId, input.clinicId),
            eq(contacts.id, input.contact.contactId),
          ),
        });
        if (contact === undefined)
          throw new AdministrativeRecordNotFoundError();
      } else {
        const existing = await transaction.query.contacts.findFirst({
          columns: { id: true },
          where: and(
            eq(contacts.clinicId, input.clinicId),
            eq(contacts.phoneE164, input.contact.phoneE164),
          ),
        });
        if (existing !== undefined) throw new ContactPhoneConflictError();

        [contact] = await transaction
          .insert(contacts)
          .values({
            clinicId: input.clinicId,
            name: input.contact.name,
            phoneE164: input.contact.phoneE164,
          })
          .returning(contactFields);
        if (contact === undefined)
          throw new Error("No se pudo crear el Contacto");
      }

      const existingLink =
        await transaction.query.contactPatientLinks.findFirst({
          columns: { id: true },
          where: and(
            eq(contactPatientLinks.clinicId, input.clinicId),
            eq(contactPatientLinks.contactId, contact.id),
            eq(contactPatientLinks.patientId, input.patientId),
          ),
        });
      if (existingLink !== undefined) {
        throw new ContactPatientLinkConflictError();
      }

      const [link] = await transaction
        .insert(contactPatientLinks)
        .values({
          clinicId: input.clinicId,
          contactId: contact.id,
          guardianshipVerificationStatus:
            input.relationship === "tutor" ? "pending" : null,
          guardianDui: input.guardianDui,
          patientId: input.patientId,
          relationship: input.relationship,
        })
        .returning({
          guardianshipVerificationStatus:
            contactPatientLinks.guardianshipVerificationStatus,
          guardianDui: contactPatientLinks.guardianDui,
          id: contactPatientLinks.id,
          relationship: contactPatientLinks.relationship,
        });
      if (link === undefined) throw new Error("No se pudo crear el Vínculo");

      return {
        ...toPatientContactLink({
          contactId: contact.id,
          contactName: contact.name,
          contactPhoneE164: contact.phoneE164,
          guardianshipVerificationStatus: link.guardianshipVerificationStatus,
          guardianDui: link.guardianDui,
          id: link.id,
          relationship: link.relationship,
        }),
      };
    });
  },

  async getPatientAdministrativeDetail(input) {
    return inClinicTransaction(input, async (transaction) => {
      await setPatientOperation(transaction);
      const patient = await transaction.query.patients.findFirst({
        columns: { birthDate: true, id: true, name: true },
        where: and(
          eq(patients.clinicId, input.clinicId),
          eq(patients.id, input.patientId),
        ),
      });
      if (patient === undefined) return undefined;

      const [linkRows, appointmentRows] = await Promise.all([
        transaction
          .select({
            contactId: contacts.id,
            contactName: contacts.name,
            contactPhoneE164: contacts.phoneE164,
            guardianshipVerificationStatus:
              contactPatientLinks.guardianshipVerificationStatus,
            guardianDui: contactPatientLinks.guardianDui,
            id: contactPatientLinks.id,
            relationship: contactPatientLinks.relationship,
          })
          .from(contactPatientLinks)
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
              eq(contactPatientLinks.patientId, input.patientId),
            ),
          )
          .orderBy(asc(contactPatientLinks.createdAt)),
        transaction
          .select({
            doctorId: doctors.id,
            doctorName: doctors.publicName,
            endsAt: appointments.endsAt,
            id: appointments.id,
            origin: appointments.origin,
            serviceName: services.name,
            startsAt: appointments.startsAt,
            status: appointments.status,
          })
          .from(appointments)
          .innerJoin(
            doctors,
            and(
              eq(appointments.clinicId, doctors.clinicId),
              eq(appointments.doctorId, doctors.id),
            ),
          )
          .leftJoin(
            serviceOffers,
            and(
              eq(appointments.clinicId, serviceOffers.clinicId),
              eq(appointments.serviceOfferId, serviceOffers.id),
            ),
          )
          .leftJoin(
            services,
            and(
              eq(serviceOffers.clinicId, services.clinicId),
              eq(serviceOffers.serviceId, services.id),
            ),
          )
          .where(
            and(
              eq(appointments.clinicId, input.clinicId),
              eq(appointments.patientId, input.patientId),
              inArray(appointments.status, ["confirmed", "cancelled"]),
            ),
          )
          .orderBy(asc(appointments.startsAt)),
      ]);
      if (appointmentRows.length === 0) {
        return {
          appointments: [],
          contacts: linkRows.map(toPatientContactLink),
          patient,
        };
      }

      const appointmentIds = appointmentRows.map(
        (appointment) => appointment.id,
      );
      const eventRows = await transaction
        .select({
          actorClinicUserId: appointmentEvents.actorClinicUserId,
          actorContactId: appointmentEvents.actorContactId,
          appointmentId: appointmentEvents.appointmentId,
          occurredAt: appointmentEvents.occurredAt,
          recipientContactId: appointmentEvents.recipientContactId,
          reason: appointmentEvents.reason,
          type: appointmentEvents.type,
        })
        .from(appointmentEvents)
        .where(
          and(
            eq(appointmentEvents.clinicId, input.clinicId),
            inArray(appointmentEvents.appointmentId, appointmentIds),
          ),
        )
        .orderBy(asc(appointmentEvents.occurredAt));
      const linkedContacts = new Map(
        linkRows.map((link) => [
          link.contactId,
          {
            id: link.contactId,
            name: link.contactName,
            phoneE164: link.contactPhoneE164,
          },
        ]),
      );

      return {
        appointments: appointmentRows.map((appointment) => ({
          doctor: {
            id: appointment.doctorId,
            name: appointment.doctorName ?? "Médico sin nombre público",
          },
          endsAt: appointment.endsAt,
          events: eventRows
            .filter((event) => event.appointmentId === appointment.id)
            .map(({ appointmentId: _, recipientContactId, ...event }) => ({
              ...event,
              recipient:
                recipientContactId === null
                  ? null
                  : (linkedContacts.get(recipientContactId) ?? null),
            })),
          id: appointment.id,
          origin: appointment.origin,
          service: {
            name: appointment.serviceName ?? "Servicio no disponible",
          },
          startsAt: appointment.startsAt,
          status: appointment.status,
        })),
        contacts: linkRows.map(toPatientContactLink),
        patient,
      };
    });
  },

  async listPatientDirectory(input) {
    return inClinicTransaction(input, async (transaction) => {
      await setPatientOperation(transaction);
      const [clinicContacts, clinicPatients, links, appointmentRows] =
        await Promise.all([
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
            columns: { contactId: true, patientId: true },
            orderBy: [asc(contactPatientLinks.createdAt)],
            where: eq(contactPatientLinks.clinicId, input.clinicId),
          }),
          transaction.query.appointments.findMany({
            columns: { patientId: true },
            where: eq(appointments.clinicId, input.clinicId),
          }),
        ]);
      const query = input.query.toLocaleLowerCase();
      const phoneQuery = input.query.replace(/[()\s.-]/g, "");
      const patientsById = new Map(
        clinicPatients.map((patient) => [patient.id, patient]),
      );
      const patientContactIds = new Map<string, string[]>();
      const contactPatientIds = new Map<string, string[]>();
      for (const link of links) {
        patientContactIds.set(link.patientId, [
          ...(patientContactIds.get(link.patientId) ?? []),
          link.contactId,
        ]);
        contactPatientIds.set(link.contactId, [
          ...(contactPatientIds.get(link.contactId) ?? []),
          link.patientId,
        ]);
      }
      const appointmentCounts = new Map<string, number>();
      for (const appointment of appointmentRows) {
        if (appointment.patientId === null) continue;
        appointmentCounts.set(
          appointment.patientId,
          (appointmentCounts.get(appointment.patientId) ?? 0) + 1,
        );
      }

      if (input.searchTarget === "contacts") {
        return {
          contacts: clinicContacts
            .filter(
              (contact) =>
                query.length === 0 ||
                contact.name.toLocaleLowerCase().includes(query) ||
                contact.phoneE164.includes(phoneQuery),
            )
            .map((contact) => {
              const patientIds = contactPatientIds.get(contact.id) ?? [];
              return {
                ...contact,
                patientIds,
                patientNames: patientIds.flatMap(
                  (patientId) => patientsById.get(patientId)?.name ?? [],
                ),
              };
            }),
          patients: [],
        };
      }

      return {
        contacts: [],
        patients: clinicPatients
          .filter(
            (patient) =>
              query.length === 0 ||
              patient.name.toLocaleLowerCase().includes(query),
          )
          .map((patient) => ({
            ...patient,
            appointmentCount: appointmentCounts.get(patient.id) ?? 0,
            contactCount: (patientContactIds.get(patient.id) ?? []).length,
          })),
      };
    });
  },

  async findContactByPhone(input) {
    return inClinicTransaction(input, async (transaction) => {
      const contact = await transaction.query.contacts.findFirst({
        columns: { id: true, name: true, phoneE164: true },
        where: and(
          eq(contacts.clinicId, input.clinicId),
          eq(contacts.phoneE164, input.phoneE164),
        ),
      });
      if (contact === undefined) return undefined;

      const links = await transaction.query.contactPatientLinks.findMany({
        columns: { patientId: true },
        orderBy: [asc(contactPatientLinks.createdAt)],
        where: and(
          eq(contactPatientLinks.clinicId, input.clinicId),
          eq(contactPatientLinks.contactId, contact.id),
        ),
      });
      return {
        ...contact,
        patientIds: links.map((link) => link.patientId),
      };
    });
  },

  async registerPatient(input) {
    return inClinicTransaction(input, async (transaction) => {
      let contact: ContactRow | undefined;
      let reusedContact = false;

      if (input.contact.kind === "existing") {
        contact = await transaction.query.contacts.findFirst({
          columns: { id: true, name: true, phoneE164: true },
          where: and(
            eq(contacts.clinicId, input.clinicId),
            eq(contacts.id, input.contact.contactId),
          ),
        });
        if (contact === undefined)
          throw new AdministrativeRecordNotFoundError();
        reusedContact = true;
      } else {
        const existing = await transaction.query.contacts.findFirst({
          columns: { id: true },
          where: and(
            eq(contacts.clinicId, input.clinicId),
            eq(contacts.phoneE164, input.contact.phoneE164),
          ),
        });
        if (existing !== undefined) throw new ContactPhoneConflictError();

        [contact] = await transaction
          .insert(contacts)
          .values({
            clinicId: input.clinicId,
            name: input.contact.name,
            phoneE164: input.contact.phoneE164,
          })
          .returning(contactFields);
        if (contact === undefined)
          throw new Error("No se pudo crear el Contacto");
      }

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

      return { contact, link, patient, reusedContact };
    });
  },

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

function toPatientContactLink(link: {
  contactId: string;
  contactName: string;
  contactPhoneE164: string;
  guardianshipVerificationStatus: string | null;
  guardianDui: string | null;
  id: string;
  relationship: string;
}) {
  return {
    contact: {
      id: link.contactId,
      name: link.contactName,
      phoneE164: link.contactPhoneE164,
    },
    guardianshipVerificationStatus:
      link.guardianshipVerificationStatus as GuardianshipVerificationStatus | null,
    guardianDui: link.guardianDui,
    id: link.id,
    relationship: link.relationship as ContactPatientRelationship,
  };
}

const contactFields = {
  id: contacts.id,
  name: contacts.name,
  phoneE164: contacts.phoneE164,
};

type ContactRow = {
  id: string;
  name: string;
  phoneE164: string;
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

function setPatientOperation(transaction: ClinicTransaction) {
  return transaction.execute(
    sql`select set_config('app.panacea_operation', 'patients', true)`,
  );
}

function isMinor(birthDate: string, now = new Date()) {
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  const adulthood = new Date(
    Date.UTC(
      birth.getUTCFullYear() + 18,
      birth.getUTCMonth(),
      birth.getUTCDate(),
    ),
  );
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return adulthood > today;
}
