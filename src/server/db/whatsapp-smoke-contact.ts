import { and, eq } from "drizzle-orm";

import type { ClinicTransaction } from "~/server/db/clinic-context";
import { contactPatientLinks, patients } from "~/server/db/schema";

export function isWhatsAppSmokeContactEligible(
  linkedPatients: ReadonlyArray<{ isTest: boolean }>,
) {
  return linkedPatients.every((patient) => patient.isTest);
}

export async function isWhatsAppSmokeContactEligibleInTransaction(
  transaction: ClinicTransaction,
  input: { clinicId: string; contactId: string },
) {
  const linkedPatients = await transaction
    .select({ isTest: patients.isTest })
    .from(contactPatientLinks)
    .innerJoin(
      patients,
      and(
        eq(patients.clinicId, contactPatientLinks.clinicId),
        eq(patients.id, contactPatientLinks.patientId),
      ),
    )
    .where(
      and(
        eq(contactPatientLinks.clinicId, input.clinicId),
        eq(contactPatientLinks.contactId, input.contactId),
      ),
    );
  return isWhatsAppSmokeContactEligible(linkedPatients);
}
