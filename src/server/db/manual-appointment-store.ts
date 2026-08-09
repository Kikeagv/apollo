import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import { CLINIC_TIMEZONE } from "~/clinic-timezone";
import {
  calculateCareOptions,
  isIntervalAvailable,
  type CareOptionInputs,
} from "~/server/application/care-options";
import {
  type CreateManualAppointmentInput,
  type ManualAppointmentCreator,
} from "~/server/application/manual-appointments";
import { inClinicTransaction } from "~/server/db/clinic-context";
import type { db } from "~/server/db";
import {
  appointmentEvents,
  appointments,
  availabilityBlocks,
  clinicUsers,
  contactPatientLinks,
  contacts,
  doctors,
  effectiveSchedulePeriods,
  effectiveSchedules,
  patients,
  serviceOffers,
  services,
  temporaryReservations,
} from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const drizzleManualAppointmentStore: ManualAppointmentCreator = {
  async create(input) {
    return inClinicTransaction(input, async (transaction) => {
      await setCalendarOperation(transaction);
      await lockDoctor(transaction, input.doctorId);
      const appointmentInput = await appointmentInputs(transaction, input);
      if (appointmentInput === undefined) return undefined;

      const localDate = clinicDate(input.startsAt);
      const options = await calculateCareOptions(
        {
          clinicId: input.clinicId,
          doctorId: input.doctorId,
          from: localDate,
          identityId: input.identityId,
          serviceId: appointmentInput.serviceId,
          to: localDate,
        },
        { find: async () => appointmentInput.capacity },
      );
      const fitsSchedule = options.some(
        (option) => option.startsAt.valueOf() === input.startsAt.valueOf(),
      );
      const outsideSchedule = !fitsSchedule;
      if (
        outsideSchedule &&
        !hasFreeCapacity(input, appointmentInput.capacity)
      ) {
        return undefined;
      }
      if (outsideSchedule && !input.outsideScheduleConfirmed) {
        return { requiresOutsideScheduleConfirmation: true };
      }

      const endsAt = addMinutes(
        input.startsAt,
        appointmentInput.durationMinutes,
      );
      const occupiedUntil = addMinutes(endsAt, appointmentInput.bufferMinutes);
      const [appointment] = await transaction
        .insert(appointments)
        .values({
          actorClinicUserId: appointmentInput.actorClinicUserId,
          bufferMinutes: appointmentInput.bufferMinutes,
          clinicId: input.clinicId,
          doctorId: input.doctorId,
          durationMinutes: appointmentInput.durationMinutes,
          endsAt,
          occupiedUntil,
          origin: "manual",
          outsideSchedule,
          patientId: input.patientId,
          priceUsd: appointmentInput.priceUsd,
          serviceOfferId: input.serviceOfferId,
          startsAt: input.startsAt,
        })
        .returning({ id: appointments.id, startsAt: appointments.startsAt });
      if (appointment === undefined)
        throw new Error("No se pudo crear la Cita");
      await transaction.insert(appointmentEvents).values({
        actorClinicUserId: appointmentInput.actorClinicUserId,
        appointmentId: appointment.id,
        clinicId: input.clinicId,
        type: "manual-created",
      });
      return {
        ...appointment,
        bufferMinutes: appointmentInput.bufferMinutes,
        durationMinutes: appointmentInput.durationMinutes,
        endsAt,
        occupiedUntil,
        origin: "manual" as const,
        outsideSchedule,
        patientId: input.patientId,
        priceUsd: appointmentInput.priceUsd,
      };
    });
  },
};

export async function listManualAppointmentFormData(input: {
  clinicId: string;
  identityId: string;
}) {
  return inClinicTransaction(input, async (transaction) => {
    await setCalendarOperation(transaction);
    const [linkedPatients, activeOffers] = await Promise.all([
      transaction
        .select({ id: patients.id, name: patients.name })
        .from(patients)
        .innerJoin(
          contactPatientLinks,
          and(
            eq(patients.clinicId, contactPatientLinks.clinicId),
            eq(patients.id, contactPatientLinks.patientId),
          ),
        )
        .where(eq(patients.clinicId, input.clinicId))
        .orderBy(asc(patients.name)),
      transaction
        .select({
          doctorId: doctors.id,
          doctorName: doctors.publicName,
          serviceName: services.name,
          serviceOfferId: serviceOffers.id,
        })
        .from(serviceOffers)
        .innerJoin(
          doctors,
          and(
            eq(serviceOffers.clinicId, doctors.clinicId),
            eq(serviceOffers.doctorId, doctors.id),
          ),
        )
        .innerJoin(
          clinicUsers,
          and(
            eq(doctors.clinicId, clinicUsers.clinicId),
            eq(doctors.clinicUserId, clinicUsers.id),
          ),
        )
        .innerJoin(
          services,
          and(
            eq(serviceOffers.clinicId, services.clinicId),
            eq(serviceOffers.serviceId, services.id),
          ),
        )
        .where(
          and(
            eq(serviceOffers.clinicId, input.clinicId),
            eq(serviceOffers.active, true),
            eq(doctors.active, true),
            eq(clinicUsers.active, true),
            inArray(clinicUsers.role, ["owner", "doctor"]),
          ),
        )
        .orderBy(asc(doctors.publicName), asc(services.name)),
    ]);
    return {
      offers: activeOffers.map((offer) => ({
        doctorId: offer.doctorId,
        doctorName: offer.doctorName ?? "Médico sin nombre público",
        serviceName: offer.serviceName,
        serviceOfferId: offer.serviceOfferId,
      })),
      patients: [
        ...new Map(
          linkedPatients.map((patient) => [patient.id, patient]),
        ).values(),
      ],
    };
  });
}

export async function listManualAppointments(input: {
  clinicId: string;
  identityId: string;
}) {
  return inClinicTransaction(input, async (transaction) => {
    await setCalendarOperation(transaction);
    const appointmentRows = await transaction
      .select({
        bufferMinutes: appointments.bufferMinutes,
        doctorId: doctors.id,
        doctorName: doctors.publicName,
        durationMinutes: appointments.durationMinutes,
        endsAt: appointments.endsAt,
        id: appointments.id,
        origin: appointments.origin,
        outsideSchedule: appointments.outsideSchedule,
        patientId: patients.id,
        patientName: patients.name,
        priceUsd: appointments.priceUsd,
        serviceName: services.name,
        startsAt: appointments.startsAt,
      })
      .from(appointments)
      .innerJoin(
        doctors,
        and(
          eq(appointments.clinicId, doctors.clinicId),
          eq(appointments.doctorId, doctors.id),
        ),
      )
      .innerJoin(
        patients,
        and(
          eq(appointments.clinicId, patients.clinicId),
          eq(appointments.patientId, patients.id),
        ),
      )
      .innerJoin(
        serviceOffers,
        and(
          eq(appointments.clinicId, serviceOffers.clinicId),
          eq(appointments.serviceOfferId, serviceOffers.id),
        ),
      )
      .innerJoin(
        services,
        and(
          eq(serviceOffers.clinicId, services.clinicId),
          eq(serviceOffers.serviceId, services.id),
        ),
      )
      .where(
        and(
          eq(appointments.clinicId, input.clinicId),
          eq(appointments.status, "confirmed"),
        ),
      )
      .orderBy(asc(appointments.startsAt));
    if (appointmentRows.length === 0) return [];

    const patientIds = appointmentRows.map(
      (appointment) => appointment.patientId,
    );
    const appointmentIds = appointmentRows.map((appointment) => appointment.id);
    const [linkedContacts, events] = await Promise.all([
      transaction
        .select({
          patientId: contactPatientLinks.patientId,
          id: contacts.id,
          name: contacts.name,
          phoneE164: contacts.phoneE164,
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
            inArray(contactPatientLinks.patientId, patientIds),
          ),
        ),
      transaction
        .select({
          actorClinicUserId: appointmentEvents.actorClinicUserId,
          appointmentId: appointmentEvents.appointmentId,
          occurredAt: appointmentEvents.occurredAt,
          type: appointmentEvents.type,
        })
        .from(appointmentEvents)
        .where(
          and(
            eq(appointmentEvents.clinicId, input.clinicId),
            inArray(appointmentEvents.appointmentId, appointmentIds),
          ),
        )
        .orderBy(asc(appointmentEvents.occurredAt)),
    ]);
    return appointmentRows.map((appointment) => ({
      bufferMinutes: appointment.bufferMinutes,
      contacts: linkedContacts
        .filter((contact) => contact.patientId === appointment.patientId)
        .map(({ patientId: _, ...contact }) => contact),
      doctor: {
        id: appointment.doctorId,
        name: appointment.doctorName ?? "Médico sin nombre público",
      },
      durationMinutes: appointment.durationMinutes,
      endsAt: addMinutes(
        appointment.startsAt,
        appointment.durationMinutes ?? 0,
      ),
      events: events
        .filter((event) => event.appointmentId === appointment.id)
        .map(({ appointmentId: _, ...event }) => event),
      id: appointment.id,
      origin: appointment.origin,
      outsideSchedule: appointment.outsideSchedule,
      patient: { id: appointment.patientId, name: appointment.patientName },
      priceUsd: appointment.priceUsd,
      service: { name: appointment.serviceName },
      startsAt: appointment.startsAt,
    }));
  });
}

function hasFreeCapacity(
  input: Pick<CreateManualAppointmentInput, "startsAt">,
  capacity: CareOptionInputs,
) {
  const occupiedUntil = addMinutes(
    input.startsAt,
    capacity.offer.durationMinutes + capacity.offer.bufferMinutes,
  );
  return isIntervalAvailable(input.startsAt, occupiedUntil, [
    ...capacity.appointments,
    ...capacity.blocks,
    ...capacity.temporaryReservations,
  ]);
}

async function appointmentInputs(
  transaction: ClinicTransaction,
  input: CreateManualAppointmentInput,
) {
  const [actor, offer, linkedContact] = await Promise.all([
    transaction.query.clinicUsers.findFirst({
      columns: { id: true },
      where: and(
        eq(clinicUsers.clinicId, input.clinicId),
        eq(clinicUsers.identityId, input.identityId),
        eq(clinicUsers.active, true),
      ),
    }),
    transaction
      .select({
        bufferMinutes: serviceOffers.bufferMinutes,
        durationMinutes: serviceOffers.durationMinutes,
        priceUsd: serviceOffers.priceUsd,
        serviceId: services.id,
      })
      .from(serviceOffers)
      .innerJoin(
        doctors,
        and(
          eq(serviceOffers.clinicId, doctors.clinicId),
          eq(serviceOffers.doctorId, doctors.id),
        ),
      )
      .innerJoin(
        clinicUsers,
        and(
          eq(doctors.clinicId, clinicUsers.clinicId),
          eq(doctors.clinicUserId, clinicUsers.id),
        ),
      )
      .innerJoin(
        services,
        and(
          eq(serviceOffers.clinicId, services.clinicId),
          eq(serviceOffers.serviceId, services.id),
        ),
      )
      .where(
        and(
          eq(serviceOffers.clinicId, input.clinicId),
          eq(serviceOffers.id, input.serviceOfferId),
          eq(serviceOffers.doctorId, input.doctorId),
          eq(serviceOffers.active, true),
          eq(doctors.active, true),
          eq(clinicUsers.active, true),
          inArray(clinicUsers.role, ["owner", "doctor"]),
        ),
      ),
    transaction.query.contactPatientLinks.findFirst({
      columns: { id: true },
      where: and(
        eq(contactPatientLinks.clinicId, input.clinicId),
        eq(contactPatientLinks.patientId, input.patientId),
      ),
    }),
  ]);
  const selectedOffer = offer[0];
  if (
    actor === undefined ||
    selectedOffer === undefined ||
    linkedContact === undefined
  ) {
    return undefined;
  }

  const capacity = await capacityInputs(transaction, input);
  return { ...selectedOffer, actorClinicUserId: actor.id, capacity };
}

async function capacityInputs(
  transaction: ClinicTransaction,
  input: CreateManualAppointmentInput,
): Promise<CareOptionInputs> {
  const [
    offer,
    schedules,
    periods,
    blocks,
    confirmedAppointments,
    reservations,
  ] = await Promise.all([
    transaction
      .select({
        bufferMinutes: serviceOffers.bufferMinutes,
        durationMinutes: serviceOffers.durationMinutes,
      })
      .from(serviceOffers)
      .where(eq(serviceOffers.id, input.serviceOfferId)),
    transaction.query.effectiveSchedules.findMany({
      columns: { effectiveFrom: true, effectiveUntil: true, id: true },
      where: and(
        eq(effectiveSchedules.clinicId, input.clinicId),
        eq(effectiveSchedules.doctorId, input.doctorId),
      ),
    }),
    transaction.query.effectiveSchedulePeriods.findMany({
      columns: {
        dayOfWeek: true,
        endTime: true,
        scheduleId: true,
        startTime: true,
      },
      where: and(
        eq(effectiveSchedulePeriods.clinicId, input.clinicId),
        eq(effectiveSchedulePeriods.doctorId, input.doctorId),
      ),
    }),
    transaction
      .select({
        endsAt: availabilityBlocks.endsAt,
        startsAt: availabilityBlocks.startsAt,
      })
      .from(availabilityBlocks)
      .where(
        and(
          eq(availabilityBlocks.clinicId, input.clinicId),
          eq(availabilityBlocks.doctorId, input.doctorId),
        ),
      ),
    transaction
      .select({
        endsAt: appointments.endsAt,
        occupiedUntil: appointments.occupiedUntil,
        startsAt: appointments.startsAt,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, input.clinicId),
          eq(appointments.doctorId, input.doctorId),
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
          eq(temporaryReservations.clinicId, input.clinicId),
          eq(temporaryReservations.doctorId, input.doctorId),
          gt(temporaryReservations.expiresAt, new Date()),
        ),
      ),
  ]);
  const selectedOffer = offer[0];
  if (selectedOffer === undefined) {
    throw new Error("No se encontró la Oferta de servicio");
  }
  return {
    appointments: confirmedAppointments.map((appointment) => ({
      endsAt: appointment.occupiedUntil ?? appointment.endsAt,
      startsAt: appointment.startsAt,
    })),
    blocks,
    offer: selectedOffer,
    schedules: schedules.map((schedule) => ({
      effectiveFrom: schedule.effectiveFrom,
      effectiveUntil: schedule.effectiveUntil,
      periods: periods
        .filter((period) => period.scheduleId === schedule.id)
        .map((period) => ({
          dayOfWeek: period.dayOfWeek,
          endTime: period.endTime.slice(0, 5),
          startTime: period.startTime.slice(0, 5),
        })),
    })),
    temporaryReservations: reservations,
  };
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.valueOf() + minutes * 60_000);
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

function lockDoctor(transaction: ClinicTransaction, doctorId: string) {
  return transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext(${doctorId}))`,
  );
}

function setCalendarOperation(transaction: ClinicTransaction) {
  return transaction.execute(
    sql`select set_config('app.panacea_operation', 'appointments', true)`,
  );
}
