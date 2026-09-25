import { and, eq, or, sql } from "drizzle-orm";

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
import { enqueueAppointmentTransactionalDeliveryInTransaction } from "~/server/db/transactional-delivery-store";
import type { db } from "~/server/db";
import {
  appointmentEvents,
  appointments,
  contactPatientLinks,
  patients,
} from "~/server/db/schema";

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
            !(await hasManageablePatientLink(transaction, {
              clinicId: input.clinicId,
              contactId: input.contactId,
              patientId: input.patientId,
            }))
          ) {
            return { kind: "unauthorized" as const };
          }
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
          const [rescheduleEvent] = await transaction
            .insert(appointmentEvents)
            .values({
              actorContactId: input.contactId,
              appointmentId: rescheduled.id,
              clinicId: input.clinicId,
              reason: input.startsAt.toISOString(),
              type: "rescheduled",
            })
            .returning({ id: appointmentEvents.id });
          if (rescheduleEvent === undefined) {
            throw new Error("No se pudo registrar la reprogramación");
          }
          await recalculateClinicReadiness(transaction, {
            clinicId: input.clinicId,
          });
          await enqueueAppointmentTransactionalDeliveryInTransaction(
            transaction,
            {
              appointmentEventId: rescheduleEvent.id,
              appointmentId: rescheduled.id,
              clinicId: input.clinicId,
              contactId: input.contactId,
              now: input.now,
              type: "reschedule",
            },
          );
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
          !(await hasManageablePatientLink(transaction, {
            clinicId: input.clinicId,
            contactId: input.contactId,
            patientId: input.patientId,
          }))
        ) {
          return { kind: "unauthorized" as const };
        }
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
        const [cancellationEvent] = await transaction
          .insert(appointmentEvents)
          .values({
            actorContactId: input.contactId,
            appointmentId: cancelled.id,
            clinicId: input.clinicId,
            type: "cancelled",
          })
          .returning({ id: appointmentEvents.id });
        if (cancellationEvent === undefined) {
          throw new Error("No se pudo registrar la cancelación de la Cita");
        }
        await recalculateClinicReadiness(transaction, {
          clinicId: input.clinicId,
        });
        await enqueueAppointmentTransactionalDeliveryInTransaction(
          transaction,
          {
            appointmentEventId: cancellationEvent.id,
            appointmentId: cancelled.id,
            clinicId: input.clinicId,
            contactId: input.contactId,
            now: input.now,
            type: "cancellation",
          },
        );
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

async function hasManageablePatientLink(
  transaction: ClinicTransaction,
  input: { clinicId: string; contactId: string; patientId: string },
) {
  const [link] = await transaction
    .select({ id: contactPatientLinks.id })
    .from(contactPatientLinks)
    .innerJoin(
      patients,
      and(
        eq(contactPatientLinks.clinicId, patients.clinicId),
        eq(contactPatientLinks.patientId, patients.id),
      ),
    )
    .where(
      and(
        eq(contactPatientLinks.clinicId, input.clinicId),
        eq(contactPatientLinks.contactId, input.contactId),
        eq(contactPatientLinks.patientId, input.patientId),
        or(
          and(
            eq(contactPatientLinks.relationship, "contact"),
            sql`${patients.birthDate} <= CURRENT_DATE - INTERVAL '18 years'`,
          ),
          and(
            eq(contactPatientLinks.relationship, "tutor"),
            eq(contactPatientLinks.guardianshipVerificationStatus, "verified"),
          ),
        ),
      ),
    )
    .limit(1);
  return link !== undefined;
}
