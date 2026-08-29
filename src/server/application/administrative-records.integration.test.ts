import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createContact,
  createContactPatientLink,
  createIncompletePatient,
  createPatient,
  findContactByPhone,
  getPatientAdministrativeDetail,
  addPatientContact,
  listAdministrativeRecords,
  listPatientDirectory,
  registerAdministrativeRecordsForManualAppointment,
  registerPatient,
  updateContact,
  updatePatient,
  verifyPatientGuardianship,
} from "./administrative-records";
import { db } from "../db";
import {
  inClinicTransaction,
  inSuperadminTransaction,
} from "../db/clinic-context";
import {
  drizzleAdministrativeRecordsStore,
  TutorOnlyForMinorPatientError,
} from "../db/administrative-records-store";
import {
  apoloSuperadmins,
  clinicUsers,
  clinics,
  contactPatientLinks,
  contacts,
  patients,
  user as identities,
} from "../db/schema";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("fichas administrativas persistentes", () => {
  databaseTest(
    "permite editar Contactos y Pacientes, vincularlos y los aísla por RLS",
    async () => {
      const fixture = await createFixture();
      try {
        const contact = await createContact(
          {
            clinicId: fixture.primary.clinicId,
            identityId: fixture.primary.identityId,
            name: "Ana Martínez",
            phone: "+503 7123-4567",
          },
          drizzleAdministrativeRecordsStore,
        );
        const patient = await createPatient(
          {
            birthDate: "2018-04-02",
            clinicId: fixture.primary.clinicId,
            identityId: fixture.primary.identityId,
            name: "Lucía Martínez",
          },
          drizzleAdministrativeRecordsStore,
        );
        const link = await createContactPatientLink(
          {
            clinicId: fixture.primary.clinicId,
            contactId: contact.id,
            identityId: fixture.primary.identityId,
            patientId: patient.id,
          },
          drizzleAdministrativeRecordsStore,
        );
        await updateContact(
          {
            clinicId: fixture.primary.clinicId,
            id: contact.id,
            identityId: fixture.primary.identityId,
            name: "Ana Reyes",
            phone: "+50372223333",
          },
          drizzleAdministrativeRecordsStore,
        );
        await updatePatient(
          {
            birthDate: "2018-04-03",
            clinicId: fixture.primary.clinicId,
            id: patient.id,
            identityId: fixture.primary.identityId,
            name: "Lucía Reyes",
          },
          drizzleAdministrativeRecordsStore,
        );

        await expect(
          listAdministrativeRecords(
            fixture.primary,
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toEqual({
          contacts: [
            {
              id: contact.id,
              name: "Ana Reyes",
              patientIds: [patient.id],
              phoneE164: "+50372223333",
            },
          ],
          patients: [
            {
              birthDate: "2018-04-03",
              contactIds: [contact.id],
              id: patient.id,
              name: "Lucía Reyes",
            },
          ],
        });
        await inClinicTransaction(fixture.other, async (transaction) => {
          await expect(
            transaction.query.contacts.findMany({
              where: eq(contacts.clinicId, fixture.primary.clinicId),
            }),
          ).resolves.toEqual([]);
          await expect(
            transaction.query.patients.findMany({
              where: eq(patients.clinicId, fixture.primary.clinicId),
            }),
          ).resolves.toEqual([]);
          await expect(
            transaction.query.contactPatientLinks.findMany({
              where: eq(contactPatientLinks.clinicId, fixture.primary.clinicId),
            }),
          ).resolves.toEqual([]);
          await expect(
            transaction
              .update(contacts)
              .set({ name: "Contacto expuesto" })
              .where(eq(contacts.id, contact.id))
              .returning({ id: contacts.id }),
          ).resolves.toEqual([]);
          await expect(
            transaction
              .update(patients)
              .set({ name: "Paciente expuesto" })
              .where(eq(patients.id, patient.id))
              .returning({ id: patients.id }),
          ).resolves.toEqual([]);
          await expect(
            transaction
              .update(contactPatientLinks)
              .set({ patientId: patient.id })
              .where(eq(contactPatientLinks.id, link.id))
              .returning({ id: contactPatientLinks.id }),
          ).resolves.toEqual([]);
        });
        await expect(
          listAdministrativeRecords(
            fixture.primary,
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toMatchObject({
          contacts: [
            expect.objectContaining({ id: contact.id, name: "Ana Reyes" }),
          ],
          patients: [
            expect.objectContaining({ id: patient.id, name: "Lucía Reyes" }),
          ],
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "mantiene el teléfono único por Clínica y los Vínculos muchos a muchos",
    async () => {
      const fixture = await createFixture();
      try {
        const ana = await createContact(
          {
            clinicId: fixture.primary.clinicId,
            identityId: fixture.primary.identityId,
            name: "Ana",
            phone: "+50370000001",
          },
          drizzleAdministrativeRecordsStore,
        );
        const carlos = await createContact(
          {
            clinicId: fixture.primary.clinicId,
            identityId: fixture.primary.identityId,
            name: "Carlos",
            phone: "+50370000002",
          },
          drizzleAdministrativeRecordsStore,
        );
        const lucia = await createPatient(
          {
            birthDate: "2018-04-02",
            clinicId: fixture.primary.clinicId,
            identityId: fixture.primary.identityId,
            name: "Lucía",
          },
          drizzleAdministrativeRecordsStore,
        );
        const pablo = await createPatient(
          {
            birthDate: "1990-01-01",
            clinicId: fixture.primary.clinicId,
            identityId: fixture.primary.identityId,
            name: "Pablo",
          },
          drizzleAdministrativeRecordsStore,
        );
        await createContactPatientLink(
          {
            clinicId: fixture.primary.clinicId,
            contactId: ana.id,
            identityId: fixture.primary.identityId,
            patientId: lucia.id,
          },
          drizzleAdministrativeRecordsStore,
        );
        await createContactPatientLink(
          {
            clinicId: fixture.primary.clinicId,
            contactId: ana.id,
            identityId: fixture.primary.identityId,
            patientId: pablo.id,
          },
          drizzleAdministrativeRecordsStore,
        );
        await createContactPatientLink(
          {
            clinicId: fixture.primary.clinicId,
            contactId: carlos.id,
            identityId: fixture.primary.identityId,
            patientId: lucia.id,
          },
          drizzleAdministrativeRecordsStore,
        );

        await expect(
          createContact(
            {
              clinicId: fixture.primary.clinicId,
              identityId: fixture.primary.identityId,
              name: "Ana duplicada",
              phone: "+50370000001",
            },
            drizzleAdministrativeRecordsStore,
          ),
        ).rejects.toThrow("Ya existe un Contacto con ese teléfono");

        const records = await listAdministrativeRecords(
          fixture.primary,
          drizzleAdministrativeRecordsStore,
        );
        expect(
          records.contacts.find((contact) => contact.id === ana.id),
        ).toMatchObject({
          patientIds: [lucia.id, pablo.id],
        });
        expect(
          records.patients.find((patient) => patient.id === lucia.id),
        ).toMatchObject({ contactIds: [ana.id, carlos.id] });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "registra fichas atómicas para una Cita manual sin filtrar otra Clínica",
    async () => {
      const fixture = await createFixture();
      try {
        const registered =
          await registerAdministrativeRecordsForManualAppointment(
            {
              birthDate: "2018-04-02",
              clinicId: fixture.primary.clinicId,
              contactName: " Ana Inline ",
              identityId: fixture.secretary.identityId,
              patientName: " Lucía Inline ",
              phone: "+503 7123-4567",
            },
            drizzleAdministrativeRecordsStore,
          );

        await expect(
          listAdministrativeRecords(
            fixture.primary,
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toEqual({
          contacts: [
            {
              id: registered.contact.id,
              name: "Ana Inline",
              patientIds: [registered.patient.id],
              phoneE164: "+50371234567",
            },
          ],
          patients: [
            {
              birthDate: "2018-04-02",
              contactIds: [registered.contact.id],
              id: registered.patient.id,
              name: "Lucía Inline",
            },
          ],
        });
        await expect(
          listAdministrativeRecords(
            fixture.other,
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toEqual({ contacts: [], patients: [] });
        await expect(
          listAdministrativeRecords(
            fixture.secretary,
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toMatchObject({
          contacts: [{ id: registered.contact.id }],
          patients: [{ id: registered.patient.id }],
        });
        await expect(
          registerAdministrativeRecordsForManualAppointment(
            {
              birthDate: "1990-01-01",
              clinicId: fixture.primary.clinicId,
              contactName: "Contacto duplicado",
              identityId: fixture.primary.identityId,
              patientName: "Paciente que no debe crearse",
              phone: "+50371234567",
            },
            drizzleAdministrativeRecordsStore,
          ),
        ).rejects.toThrow("Ya existe un Contacto con ese teléfono");
        await expect(
          listAdministrativeRecords(
            fixture.primary,
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toEqual({
          contacts: [
            {
              id: registered.contact.id,
              name: "Ana Inline",
              patientIds: [registered.patient.id],
              phoneE164: "+50371234567",
            },
          ],
          patients: [
            {
              birthDate: "2018-04-02",
              contactIds: [registered.contact.id],
              id: registered.patient.id,
              name: "Lucía Inline",
            },
          ],
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "completa el flujo Paciente-primero, conserva cardinalidad y aísla el directorio por RLS",
    async () => {
      const fixture = await createFixture();
      try {
        const first = await registerPatient(
          {
            birthDate: "2018-04-02",
            clinicId: fixture.primary.clinicId,
            contact: {
              kind: "new",
              name: "Ana Martínez",
              phone: "+503 7123-4567",
            },
            guardianDui: "01234567-8",
            identityId: fixture.primary.identityId,
            patientName: "Lucía Martínez",
            relationship: "tutor",
          },
          drizzleAdministrativeRecordsStore,
        );
        const second = await registerPatient(
          {
            birthDate: "2015-08-11",
            clinicId: fixture.primary.clinicId,
            contact: { contactId: first.contact.id, kind: "existing" },
            guardianDui: "01234567-8",
            identityId: fixture.secretary.identityId,
            patientName: "Mateo Martínez",
            relationship: "tutor",
          },
          drizzleAdministrativeRecordsStore,
        );
        const incomplete = await createIncompletePatient(
          {
            birthDate: "2020-01-10",
            clinicId: fixture.primary.clinicId,
            identityId: fixture.primary.identityId,
            name: "Sofía López",
          },
          drizzleAdministrativeRecordsStore,
        );
        const adultRegistration = await registerPatient(
          {
            birthDate: "1990-01-01",
            clinicId: fixture.primary.clinicId,
            contact: {
              kind: "new",
              name: "Nombre que ya no se solicita",
              phone: "+503 7000-0002",
            },
            identityId: fixture.primary.identityId,
            patientName: "Pablo Adulto",
          },
          drizzleAdministrativeRecordsStore,
        );
        const adult = adultRegistration.patient;
        expect(adultRegistration).toMatchObject({
          contact: {
            name: "Pablo Adulto",
            phoneE164: "+50370000002",
          },
          patient: { id: adult.id, name: "Pablo Adulto" },
        });
        await expect(
          addPatientContact(
            {
              clinicId: fixture.primary.clinicId,
              contact: {
                kind: "new",
                name: "Tutor no válido",
                phone: "+50370000009",
              },
              guardianDui: "01234567-9",
              identityId: fixture.primary.identityId,
              patientId: adult.id,
              relationship: "tutor",
            },
            drizzleAdministrativeRecordsStore,
          ),
        ).rejects.toBeInstanceOf(TutorOnlyForMinorPatientError);
        const tutor = await addPatientContact(
          {
            clinicId: fixture.primary.clinicId,
            contact: {
              kind: "new",
              name: "Carlos López",
              phone: "+503 7000-0001",
            },
            guardianDui: "01234567-8",
            identityId: fixture.secretary.identityId,
            patientId: incomplete.id,
            relationship: "tutor",
          },
          drizzleAdministrativeRecordsStore,
        );
        await expect(
          verifyPatientGuardianship(
            {
              clinicId: fixture.primary.clinicId,
              identityId: fixture.primary.identityId,
              linkId: tutor.id,
            },
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toMatchObject({
          guardianshipVerificationStatus: "verified",
          id: tutor.id,
        });

        await expect(
          findContactByPhone(
            {
              clinicId: fixture.primary.clinicId,
              identityId: fixture.secretary.identityId,
              phone: "+50370000001",
            },
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toMatchObject({
          id: tutor.contact.id,
          patientIds: [incomplete.id],
        });
        await expect(
          registerPatient(
            {
              birthDate: "2012-01-01",
              clinicId: fixture.primary.clinicId,
              contact: {
                kind: "new",
                name: "No debe duplicarse",
                phone: "+503 7123-4567",
              },
              identityId: fixture.primary.identityId,
              patientName: "No debe crearse",
            },
            drizzleAdministrativeRecordsStore,
          ),
        ).rejects.toThrow("Ya existe un Contacto con ese teléfono");

        await expect(
          drizzleAdministrativeRecordsStore.registerPatient({
            birthDate: "fecha inválida",
            clinicId: fixture.primary.clinicId,
            contact: {
              kind: "new",
              name: "Contacto que debe revertirse",
              phoneE164: "+50370000008",
            },
            guardianDui: null,
            identityId: fixture.primary.identityId,
            patientName: "Paciente que debe revertirse",
            relationship: "contact",
          }),
        ).rejects.toThrow();
        await expect(
          findContactByPhone(
            {
              clinicId: fixture.primary.clinicId,
              identityId: fixture.primary.identityId,
              phone: "+50370000008",
            },
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toBeUndefined();

        const directory = await listPatientDirectory(
          {
            clinicId: fixture.primary.clinicId,
            identityId: fixture.secretary.identityId,
            searchTarget: "patients",
          },
          drizzleAdministrativeRecordsStore,
        );
        expect(directory.patients).toHaveLength(4);
        expect(directory.patients).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ contactCount: 1, id: incomplete.id }),
            expect.objectContaining({ contactCount: 1, id: first.patient.id }),
            expect.objectContaining({ contactCount: 1, id: second.patient.id }),
            expect.objectContaining({ contactCount: 1, id: adult.id }),
          ]),
        );
        await expect(
          listPatientDirectory(
            {
              clinicId: fixture.primary.clinicId,
              identityId: fixture.secretary.identityId,
              query: "Ana",
              searchTarget: "contacts",
            },
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toMatchObject({
          contacts: [
            {
              id: first.contact.id,
              patientIds: [first.patient.id, second.patient.id],
              patientNames: ["Lucía Martínez", "Mateo Martínez"],
            },
          ],
          patients: [],
        });
        await expect(
          listPatientDirectory(
            {
              clinicId: fixture.other.clinicId,
              identityId: fixture.other.identityId,
              searchTarget: "patients",
            },
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toEqual({ contacts: [], patients: [] });
        await expect(
          getPatientAdministrativeDetail(
            {
              clinicId: fixture.primary.clinicId,
              identityId: fixture.secretary.identityId,
              patientId: incomplete.id,
            },
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toMatchObject({
          contacts: [
            {
              contact: { id: tutor.contact.id },
              guardianshipVerificationStatus: "verified",
              id: tutor.id,
              relationship: "tutor",
            },
          ],
          patient: { id: incomplete.id, name: "Sofía López" },
        });
        await expect(
          getPatientAdministrativeDetail(
            {
              clinicId: fixture.primary.clinicId,
              identityId: fixture.primary.identityId,
              patientId: adult.id,
            },
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toMatchObject({
          contacts: [
            {
              contact: { id: adultRegistration.contact.id },
              guardianDui: null,
              guardianshipVerificationStatus: null,
              relationship: "contact",
            },
          ],
          patient: { id: adult.id, name: "Pablo Adulto" },
        });
        await expect(
          getPatientAdministrativeDetail(
            {
              clinicId: fixture.other.clinicId,
              identityId: fixture.other.identityId,
              patientId: incomplete.id,
            },
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toBeUndefined();
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

async function createFixture() {
  const suffix = randomUUID();
  const identitiesByRole = {
    otherOwner: `apo-38-other-owner-${suffix}`,
    owner: `apo-38-owner-${suffix}`,
    secretary: `apo-46-secretary-${suffix}`,
    superadmin: `apo-38-superadmin-${suffix}`,
  };
  await db.insert(identities).values(
    Object.entries(identitiesByRole).map(([role, id]) => ({
      createdAt: new Date(),
      email: `${id}@example.test`,
      emailVerified: true,
      id,
      name: role,
      updatedAt: new Date(),
    })),
  );
  await db
    .insert(apoloSuperadmins)
    .values({ identityId: identitiesByRole.superadmin });

  const createClinic = async (identityId: string, name: string) =>
    inSuperadminTransaction(
      identitiesByRole.superadmin,
      async (transaction) => {
        const [clinic] = await transaction
          .insert(clinics)
          .values({ isSynthetic: true, name })
          .returning({ id: clinics.id });
        if (clinic === undefined) throw new Error("No se creó la Clínica");
        await transaction.execute(
          sql`select set_config('app.clinic_id', ${clinic.id}, true)`,
        );
        await transaction.insert(clinicUsers).values({
          clinicId: clinic.id,
          identityId,
          role: "owner",
        });
        return { clinicId: clinic.id, identityId };
      },
    );

  const primary = await createClinic(
    identitiesByRole.owner,
    "Clínica principal APO-38",
  );
  const other = await createClinic(
    identitiesByRole.otherOwner,
    "Clínica externa APO-38",
  );
  const secretary = {
    clinicId: primary.clinicId,
    identityId: identitiesByRole.secretary,
  };
  await inSuperadminTransaction(
    identitiesByRole.superadmin,
    async (transaction) => {
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${primary.clinicId}, true)`,
      );
      await transaction.insert(clinicUsers).values({
        clinicId: primary.clinicId,
        identityId: secretary.identityId,
        role: "secretary",
      });
    },
  );
  return {
    other,
    primary,
    secretary,
    async cleanup() {
      for (const { clinicId } of [primary, other]) {
        await inSuperadminTransaction(
          identitiesByRole.superadmin,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${clinicId}, true)`,
            );
            await transaction.delete(clinics).where(eq(clinics.id, clinicId));
          },
        );
      }
      await db
        .delete(apoloSuperadmins)
        .where(eq(apoloSuperadmins.identityId, identitiesByRole.superadmin));
      await db
        .delete(identities)
        .where(
          and(
            eq(identities.id, identitiesByRole.superadmin),
            eq(identities.id, identitiesByRole.owner),
          ),
        );
      await db
        .delete(identities)
        .where(eq(identities.id, identitiesByRole.owner));
      await db
        .delete(identities)
        .where(eq(identities.id, identitiesByRole.otherOwner));
      await db
        .delete(identities)
        .where(eq(identities.id, identitiesByRole.secretary));
      await db
        .delete(identities)
        .where(eq(identities.id, identitiesByRole.superadmin));
    },
  };
}
