import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createContact,
  createContactPatientLink,
  createPatient,
  listAdministrativeRecords,
  updateContact,
  updatePatient,
} from "./administrative-records";
import { db } from "../db";
import {
  inClinicTransaction,
  inSuperadminTransaction,
} from "../db/clinic-context";
import { drizzleAdministrativeRecordsStore } from "../db/administrative-records-store";
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
});

async function createFixture() {
  const suffix = randomUUID();
  const identitiesByRole = {
    otherOwner: `apo-38-other-owner-${suffix}`,
    owner: `apo-38-owner-${suffix}`,
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
  return {
    other,
    primary,
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
        .where(eq(identities.id, identitiesByRole.superadmin));
    },
  };
}
