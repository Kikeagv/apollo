import { and, eq, sql } from "drizzle-orm";

import { CapacityConflictError } from "~/server/application/availability";
import {
  type DoctorDeactivator,
  type DoctorSummary,
} from "~/server/application/doctor-status";
import { inClinicTransaction } from "~/server/db/clinic-context";
import type { db } from "~/server/db";
import { capacityConflictsForDoctor } from "~/server/db/doctor-occupancy-store";
import {
  clinicUsers,
  configurationAuditEvents,
  doctors,
} from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const drizzleDoctorStatusStore: DoctorDeactivator = {
  async deactivate(input) {
    return inClinicTransaction(input, async (transaction) => {
      if (!(await isOwner(transaction, input))) return undefined;

      await lockDoctor(transaction, input.doctorId);
      const doctor = await transaction.query.doctors.findFirst({
        columns: {
          active: true,
          id: true,
          primarySpecialty: true,
          publicName: true,
        },
        where: and(
          eq(doctors.clinicId, input.clinicId),
          eq(doctors.id, input.doctorId),
          eq(doctors.active, true),
        ),
      });
      if (doctor === undefined) return undefined;

      const conflicts = await capacityConflictsForDoctor(transaction, input);
      if (conflicts.length > 0) throw new CapacityConflictError(conflicts);

      const [deactivated] = await transaction
        .update(doctors)
        .set({ active: false, deactivatedAt: new Date() })
        .where(eq(doctors.id, doctor.id))
        .returning({
          active: doctors.active,
          id: doctors.id,
          primarySpecialty: doctors.primarySpecialty,
          publicName: doctors.publicName,
        });
      if (deactivated === undefined) return undefined;

      await transaction.insert(configurationAuditEvents).values({
        action: "doctor-deactivated",
        actorIdentityId: input.identityId,
        afterValues: doctorAuditValues(deactivated),
        beforeValues: doctorAuditValues(doctor),
        clinicId: input.clinicId,
        entity: "doctor",
        entityId: doctor.id,
      });
      return deactivated as DoctorSummary & { active: false };
    });
  },
};

/** El propietario consulta Médicos activos e históricos de su Clínica. */
export async function listDoctors(input: {
  clinicId: string;
  identityId: string;
}): Promise<DoctorSummary[]> {
  return inClinicTransaction(input, async (transaction) => {
    if (!(await isOwner(transaction, input))) return [];
    return transaction.query.doctors.findMany({
      columns: {
        active: true,
        id: true,
        primarySpecialty: true,
        publicName: true,
      },
      orderBy: (table, { asc }) => [asc(table.createdAt)],
      where: eq(doctors.clinicId, input.clinicId),
    });
  });
}

async function isOwner(
  transaction: ClinicTransaction,
  input: { clinicId: string; identityId: string },
) {
  const owner = await transaction.query.clinicUsers.findFirst({
    columns: { id: true },
    where: and(
      eq(clinicUsers.clinicId, input.clinicId),
      eq(clinicUsers.identityId, input.identityId),
      eq(clinicUsers.active, true),
      eq(clinicUsers.role, "owner"),
    ),
  });
  return owner !== undefined;
}

function lockDoctor(transaction: ClinicTransaction, doctorId: string) {
  return transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext(${doctorId}))`,
  );
}

function doctorAuditValues(doctor: DoctorSummary) {
  return {
    active: String(doctor.active),
    primarySpecialty: doctor.primarySpecialty,
    publicName: doctor.publicName,
  };
}
