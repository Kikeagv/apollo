import { and, eq, gt, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";

import { CLINIC_TIMEZONE } from "~/clinic-timezone";
import type { CareOptionInputs } from "~/server/application/care-options";
import type { db } from "~/server/db";
import {
  appointments,
  availabilityBlocks,
  effectiveSchedulePeriods,
  effectiveSchedules,
  temporaryReservations,
} from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AgendaCapacityWindow = {
  clinicId: string;
  doctorId: string;
  endsAt: Date;
  startsAt: Date;
};

/**
 * Insumos de capacidad que comparten Asclepio y Panacea dentro de su propia
 * transacción. Cada llamador conserva la elegibilidad de su Oferta.
 */
export async function readAgendaCapacity(
  transaction: ClinicTransaction,
  input: AgendaCapacityWindow,
): Promise<Omit<CareOptionInputs, "offer">> {
  const firstLocalDate = clinicDate(input.startsAt);
  const lastLocalDate = clinicDate(input.endsAt);
  const schedules = await transaction.query.effectiveSchedules.findMany({
    columns: { effectiveFrom: true, effectiveUntil: true, id: true },
    where: and(
      eq(effectiveSchedules.clinicId, input.clinicId),
      eq(effectiveSchedules.doctorId, input.doctorId),
      lte(effectiveSchedules.effectiveFrom, lastLocalDate),
      or(
        isNull(effectiveSchedules.effectiveUntil),
        gte(effectiveSchedules.effectiveUntil, firstLocalDate),
      ),
    ),
  });
  const scheduleIds = schedules.map((schedule) => schedule.id);
  const [periods, blocks, confirmedAppointments, reservations] =
    await Promise.all([
      scheduleIds.length === 0
        ? []
        : transaction.query.effectiveSchedulePeriods.findMany({
            columns: {
              dayOfWeek: true,
              endTime: true,
              scheduleId: true,
              startTime: true,
            },
            where: and(
              eq(effectiveSchedulePeriods.clinicId, input.clinicId),
              eq(effectiveSchedulePeriods.doctorId, input.doctorId),
              inArray(effectiveSchedulePeriods.scheduleId, scheduleIds),
            ),
          }),
      transaction
        .select({
          endsAt: availabilityBlocks.endsAt,
          startsAt: availabilityBlocks.startsAt,
        })
        .from(availabilityBlocks)
        .where(overlapsWindow(availabilityBlocks, input)),
      transaction
        .select({
          endsAt: appointments.endsAt,
          occupiedUntil: appointments.occupiedUntil,
          startsAt: appointments.startsAt,
        })
        .from(appointments)
        .where(
          and(
            overlapsWindow(appointments, input),
            eq(appointments.status, "confirmed"),
          ),
        ),
      transaction
        .select({
          endsAt: temporaryReservations.endsAt,
          expiresAt: temporaryReservations.expiresAt,
          startsAt: temporaryReservations.startsAt,
        })
        .from(temporaryReservations)
        .where(
          and(
            overlapsWindow(temporaryReservations, input),
            gt(temporaryReservations.expiresAt, new Date()),
          ),
        ),
    ]);

  return {
    appointments: confirmedAppointments.map((appointment) => ({
      endsAt: appointment.occupiedUntil ?? appointment.endsAt,
      startsAt: appointment.startsAt,
    })),
    blocks,
    schedules: schedules.map((schedule) => ({
      effectiveFrom: schedule.effectiveFrom,
      effectiveUntil: schedule.effectiveUntil,
      periods: periods
        .filter((period) => period.scheduleId === schedule.id)
        .map(({ dayOfWeek, endTime, startTime }) => ({
          dayOfWeek,
          endTime: clockTime(endTime),
          startTime: clockTime(startTime),
        })),
    })),
    temporaryReservations: reservations,
  };
}

function overlapsWindow(
  table:
    | typeof appointments
    | typeof availabilityBlocks
    | typeof temporaryReservations,
  input: AgendaCapacityWindow,
) {
  const occupiedUntil =
    table === appointments ? appointments.occupiedUntil : table.endsAt;
  return and(
    eq(table.clinicId, input.clinicId),
    eq(table.doctorId, input.doctorId),
    lt(table.startsAt, input.endsAt),
    or(gt(table.endsAt, input.startsAt), gt(occupiedUntil, input.startsAt)),
  );
}

function clockTime(value: string) {
  return value.slice(0, 5);
}

function clinicDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: CLINIC_TIMEZONE,
    year: "numeric",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
