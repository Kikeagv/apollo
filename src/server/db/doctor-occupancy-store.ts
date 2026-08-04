import { and, eq, gt } from "drizzle-orm";

import { type CapacityConflict } from "~/server/application/availability";
import type { db } from "~/server/db";
import { appointments, temporaryReservations } from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Ocupación que impediría un cambio de configuración que reduce capacidad. */
export async function capacityConflictsForDoctor(
  transaction: ClinicTransaction,
  input: { clinicId: string; doctorId: string },
): Promise<CapacityConflict[]> {
  const now = new Date();
  const [confirmed, reservations] = await Promise.all([
    transaction
      .select({
        endsAt: appointments.endsAt,
        id: appointments.id,
        startsAt: appointments.startsAt,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, input.clinicId),
          eq(appointments.doctorId, input.doctorId),
          eq(appointments.status, "confirmed"),
          gt(appointments.endsAt, now),
        ),
      ),
    transaction
      .select({
        endsAt: temporaryReservations.endsAt,
        id: temporaryReservations.id,
        startsAt: temporaryReservations.startsAt,
      })
      .from(temporaryReservations)
      .where(
        and(
          eq(temporaryReservations.clinicId, input.clinicId),
          eq(temporaryReservations.doctorId, input.doctorId),
          gt(temporaryReservations.expiresAt, now),
        ),
      ),
  ]);
  return [
    ...confirmed.map((event) =>
      capacityConflict(event, input.doctorId, "confirmed-appointment"),
    ),
    ...reservations.map((event) =>
      capacityConflict(event, input.doctorId, "active-temporary-reservation"),
    ),
  ];
}

function capacityConflict(
  event: { endsAt: Date; id: string; startsAt: Date },
  doctorId: string,
  kind: CapacityConflict["kind"],
): CapacityConflict {
  return {
    doctorId,
    endsAt: event.endsAt.toISOString(),
    id: event.id,
    kind,
    startsAt: event.startsAt.toISOString(),
  };
}
