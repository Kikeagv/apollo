import { and, eq, sql } from "drizzle-orm";

import { CLINIC_UTC_OFFSET } from "~/clinic-timezone";
import {
  canAuthorSelfManageAppointment,
  type AgendaAppointmentCanceller,
  type AgendaAppointmentRescheduler,
} from "~/server/application/appointment-self-management";
import {
  calculateCareOptionsFromInputs,
  type CareOptionInputs,
} from "~/server/application/care-options";
import { readAgendaCapacity } from "~/server/db/agenda-capacity-store";
import { inSimulatedWhatsAppClinicTransaction } from "~/server/db/clinic-context";
import { recalculateClinicReadiness } from "~/server/db/clinic-setup-store";
import type { db } from "~/server/db";
import { appointmentEvents, appointments } from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Adaptador de Agenda: recalcula y muta una Cita solicitada por Asclepio. */
export const drizzleAgendaAppointmentRescheduler: AgendaAppointmentRescheduler =
  {
    async rescheduleAppointment(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          const current = await transaction.query.appointments.findFirst({
            columns: {
              authorContactId: true,
              bufferMinutes: true,
              doctorId: true,
              durationMinutes: true,
              startsAt: true,
            },
            where: and(
              eq(appointments.clinicId, input.clinicId),
              eq(appointments.id, input.appointmentId),
              eq(appointments.patientId, input.patientId),
              eq(appointments.status, "confirmed"),
            ),
          });
          if (current === undefined) return { kind: "unavailable" as const };
          if (
            !canAuthorSelfManageAppointment(current, input.contactId, input.now)
          ) {
            return { kind: "unauthorized" as const };
          }
          if (
            current.durationMinutes === null ||
            current.bufferMinutes === null
          ) {
            return { kind: "unavailable" as const };
          }
          await lockDoctor(transaction, current.doctorId);
          const endsAt = addMinutes(input.startsAt, current.durationMinutes);
          const occupiedUntil = addMinutes(endsAt, current.bufferMinutes);
          const options = await agendaOptions(transaction, {
            clinicId: input.clinicId,
            doctorId: current.doctorId,
            now: input.now,
            offer: {
              bufferMinutes: current.bufferMinutes,
              durationMinutes: current.durationMinutes,
            },
            on: localDate(input.startsAt),
          });
          if (
            input.startsAt.valueOf() !== current.startsAt.valueOf() &&
            !options.some(
              (option) =>
                option.startsAt.valueOf() === input.startsAt.valueOf(),
            )
          ) {
            return { kind: "unavailable" as const };
          }
          const [rescheduled] = await transaction
            .update(appointments)
            .set({ endsAt, occupiedUntil, startsAt: input.startsAt })
            .where(
              and(
                eq(appointments.clinicId, input.clinicId),
                eq(appointments.id, input.appointmentId),
                eq(appointments.status, "confirmed"),
              ),
            )
            .returning({
              id: appointments.id,
              startsAt: appointments.startsAt,
            });
          if (rescheduled === undefined)
            return { kind: "unavailable" as const };
          await transaction.insert(appointmentEvents).values({
            actorContactId: input.contactId,
            appointmentId: rescheduled.id,
            clinicId: input.clinicId,
            reason: input.startsAt.toISOString(),
            type: "rescheduled",
          });
          await recalculateClinicReadiness(transaction, {
            clinicId: input.clinicId,
          });
          return { ...rescheduled, kind: "rescheduled" as const };
        },
      );
    },
  };

export const drizzleAgendaAppointmentCanceller: AgendaAppointmentCanceller = {
  async cancelAppointment(input) {
    return inSimulatedWhatsAppClinicTransaction(
      input.clinicId,
      async (transaction) => {
        const appointment = await transaction.query.appointments.findFirst({
          columns: { authorContactId: true, startsAt: true },
          where: and(
            eq(appointments.clinicId, input.clinicId),
            eq(appointments.id, input.appointmentId),
            eq(appointments.patientId, input.patientId),
            eq(appointments.status, "confirmed"),
          ),
        });
        if (appointment === undefined) return { kind: "unavailable" as const };
        if (
          !canAuthorSelfManageAppointment(
            appointment,
            input.contactId,
            input.now,
          )
        ) {
          return { kind: "unauthorized" as const };
        }
        const [cancelled] = await transaction
          .update(appointments)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(appointments.clinicId, input.clinicId),
              eq(appointments.id, input.appointmentId),
              eq(appointments.status, "confirmed"),
            ),
          )
          .returning({ id: appointments.id });
        if (cancelled === undefined) return { kind: "unavailable" as const };
        await transaction.insert(appointmentEvents).values({
          actorContactId: input.contactId,
          appointmentId: cancelled.id,
          clinicId: input.clinicId,
          type: "cancelled",
        });
        await recalculateClinicReadiness(transaction, {
          clinicId: input.clinicId,
        });
        return { ...cancelled, kind: "cancelled" as const };
      },
    );
  },
};

async function agendaOptions(
  transaction: ClinicTransaction,
  input: {
    clinicId: string;
    doctorId: string;
    now: Date;
    offer: { bufferMinutes: number; durationMinutes: number };
    on: string;
  },
) {
  const startsAt = new Date(`${input.on}T00:00:00${CLINIC_UTC_OFFSET}`);
  const endsAt = new Date(startsAt.valueOf() + 24 * 60 * 60_000);
  const capacity: CareOptionInputs = {
    ...(await readAgendaCapacity(
      transaction,
      { clinicId: input.clinicId, doctorId: input.doctorId, endsAt, startsAt },
      input.now,
    )),
    offer: input.offer,
  };
  return calculateCareOptionsFromInputs(
    { from: input.on, to: input.on },
    capacity,
    input.now,
  );
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.valueOf() + minutes * 60_000);
}

function localDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/El_Salvador",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function lockDoctor(transaction: ClinicTransaction, doctorId: string) {
  return transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext(${doctorId}))`,
  );
}
