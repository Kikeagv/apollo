import { and, asc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";

import { CLINIC_TIMEZONE } from "~/clinic-timezone";
import {
  calculateCareOptions,
  isIntervalAvailable,
  type CareOptionInputs,
} from "~/server/application/care-options";
import { readAgendaCapacity } from "~/server/db/agenda-capacity-store";
import {
  type CreateManualAppointmentInput,
  type PanaceaCalendarInput,
  type PanaceaCalendarDoctorReader,
  type PanaceaCalendarReader,
  type ManualAppointmentCanceller,
  type ManualAppointmentCreator,
  type ManualAppointmentMessageDeliveryRecorder,
  type ManualAppointmentMessageType,
  type ManualAppointmentReader,
} from "~/server/application/manual-appointments";
import { type AppointmentReminderStore } from "~/server/application/appointment-reminders";
import { inClinicTransaction } from "~/server/db/clinic-context";
import { recalculateClinicReadiness } from "~/server/db/clinic-setup-store";
import type { db } from "~/server/db";
import {
  appointmentEvents,
  appointments,
  availabilityBlocks,
  clinicUsers,
  contactPatientLinks,
  contacts,
  doctors,
  patients,
  serviceOffers,
  services,
  simulatedWhatsAppMessages,
} from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const drizzleManualAppointmentStore: ManualAppointmentCreator &
  ManualAppointmentCanceller &
  ManualAppointmentMessageDeliveryRecorder &
  ManualAppointmentReader &
  AppointmentReminderStore &
  PanaceaCalendarReader &
  PanaceaCalendarDoctorReader = {
  async create(input, now = new Date()) {
    return inClinicTransaction(input, async (transaction) => {
      await setCalendarOperation(transaction);
      await lockDoctor(transaction, input.doctorId);
      const appointmentInput = await appointmentInputs(transaction, input);
      if (appointmentInput === undefined) return undefined;
      const capacity: CareOptionInputs = {
        ...(await readAgendaCapacity(
          transaction,
          {
            clinicId: input.clinicId,
            doctorId: input.doctorId,
            endsAt: addMinutes(
              input.startsAt,
              appointmentInput.durationMinutes + appointmentInput.bufferMinutes,
            ),
            startsAt: input.startsAt,
          },
          now,
        )),
        offer: appointmentInput,
      };

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
        { find: async () => capacity },
        now,
      );
      const fitsSchedule = options.some(
        (option) => option.startsAt.valueOf() === input.startsAt.valueOf(),
      );
      const outsideSchedule = !fitsSchedule;
      if (outsideSchedule && !hasFreeCapacity(input, capacity)) {
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
      await recalculateClinicReadiness(transaction, {
        actorIdentityId: input.identityId,
        clinicId: input.clinicId,
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
        transactionalMessage: appointmentInput.notificationRecipient && {
          appointmentId: appointment.id,
          clinicId: input.clinicId,
          recipient: appointmentInput.notificationRecipient,
          type: "manual-confirmation" as const,
        },
      };
    });
  },

  async listReminderRecipients(input) {
    return inClinicTransaction(input, async (transaction) => {
      const appointment = await transaction.query.appointments.findFirst({
        columns: {
          authorContactId: true,
          id: true,
          origin: true,
          patientId: true,
          startsAt: true,
        },
        where: and(
          eq(appointments.clinicId, input.clinicId),
          eq(appointments.id, input.appointmentId),
          eq(appointments.status, "confirmed"),
        ),
      });
      if (appointment === undefined) return undefined;
      if (appointment.patientId === null) return [];
      const reminderHours = { "20h": 20, "22h": 22, "24h": 24 } as const;
      const expectedStart = new Date(
        input.now.valueOf() + reminderHours[input.checkpoint] * 60 * 60_000,
      );
      if (
        Math.abs(appointment.startsAt.valueOf() - expectedStart.valueOf()) >
        15 * 60_000
      ) {
        return [];
      }
      const [confirmation, alreadySent] = await Promise.all([
        transaction.query.appointmentEvents.findFirst({
          columns: { occurredAt: true },
          where: and(
            eq(appointmentEvents.clinicId, input.clinicId),
            eq(appointmentEvents.appointmentId, input.appointmentId),
            inArray(appointmentEvents.type, [
              "manual-created",
              "reservation-confirmed",
            ]),
          ),
        }),
        transaction.query.appointmentEvents.findFirst({
          columns: { id: true },
          where: and(
            eq(appointmentEvents.clinicId, input.clinicId),
            eq(appointmentEvents.appointmentId, input.appointmentId),
            eq(appointmentEvents.type, "reminder-sent"),
            eq(appointmentEvents.reason, input.checkpoint),
          ),
        }),
      ]);
      if (confirmation === undefined || alreadySent !== undefined) return [];
      const replied = await transaction
        .select({ id: simulatedWhatsAppMessages.id })
        .from(simulatedWhatsAppMessages)
        .innerJoin(
          contactPatientLinks,
          and(
            eq(
              simulatedWhatsAppMessages.clinicId,
              contactPatientLinks.clinicId,
            ),
            eq(
              simulatedWhatsAppMessages.contactId,
              contactPatientLinks.contactId,
            ),
          ),
        )
        .where(
          and(
            eq(simulatedWhatsAppMessages.clinicId, input.clinicId),
            eq(contactPatientLinks.patientId, appointment.patientId),
            gt(simulatedWhatsAppMessages.createdAt, confirmation.occurredAt),
          ),
        )
        .limit(1)
        .then((messages) => messages[0]);
      if (replied !== undefined) return [];
      const recipients = await transaction
        .select({
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
            eq(contactPatientLinks.patientId, appointment.patientId),
            appointment.origin === "manual"
              ? undefined
              : or(
                  eq(contactPatientLinks.relationship, "tutor"),
                  appointment.authorContactId === null
                    ? undefined
                    : eq(
                        contactPatientLinks.contactId,
                        appointment.authorContactId,
                      ),
                ),
          ),
        );
      return recipients;
    });
  },

  async recordReminderDelivery(input) {
    return inClinicTransaction(input, async (transaction) => {
      const actor = await transaction.query.clinicUsers.findFirst({
        columns: { id: true },
        where: and(
          eq(clinicUsers.clinicId, input.clinicId),
          eq(clinicUsers.identityId, input.identityId),
          eq(clinicUsers.active, true),
        ),
      });
      if (actor === undefined) {
        throw new Error(
          "No se encontró el Usuario de clínica para el recordatorio",
        );
      }
      await transaction.insert(appointmentEvents).values({
        actorClinicUserId: actor.id,
        appointmentId: input.appointmentId,
        clinicId: input.clinicId,
        occurredAt: input.now,
        recipientContactId: input.recipientContactId,
        reason: input.checkpoint,
        type: input.result === "sent" ? "reminder-sent" : "reminder-failed",
      });
    });
  },

  async cancel(input) {
    return inClinicTransaction(input, async (transaction) => {
      await setCalendarOperation(transaction);
      const [actor, notificationRecipient] = await Promise.all([
        transaction.query.clinicUsers.findFirst({
          columns: { id: true },
          where: and(
            eq(clinicUsers.clinicId, input.clinicId),
            eq(clinicUsers.identityId, input.identityId),
            eq(clinicUsers.active, true),
          ),
        }),
        notificationRecipientForAppointment(
          transaction,
          input.clinicId,
          input.appointmentId,
          input.notificationRecipientContactId,
        ),
      ]);
      if (actor === undefined) return undefined;
      if (
        input.notificationRecipientContactId !== undefined &&
        notificationRecipient === undefined
      ) {
        return undefined;
      }
      const [appointment] = await transaction
        .update(appointments)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(appointments.id, input.appointmentId),
            eq(appointments.clinicId, input.clinicId),
            eq(appointments.origin, "manual"),
            eq(appointments.status, "confirmed"),
            gt(appointments.startsAt, input.now),
          ),
        )
        .returning({ id: appointments.id });
      if (appointment === undefined) return undefined;
      await transaction.insert(appointmentEvents).values({
        actorClinicUserId: actor.id,
        appointmentId: appointment.id,
        clinicId: input.clinicId,
        reason: input.reason,
        type: "cancelled",
      });
      await recalculateClinicReadiness(transaction, {
        actorIdentityId: input.identityId,
        clinicId: input.clinicId,
      });
      return {
        ...appointment,
        status: "cancelled" as const,
        transactionalMessage: notificationRecipient && {
          appointmentId: appointment.id,
          clinicId: input.clinicId,
          recipient: notificationRecipient,
          type: "manual-cancellation" as const,
        },
      };
    });
  },

  async recordMessageDelivery(input) {
    return inClinicTransaction(
      { clinicId: input.clinicId, identityId: input.actorIdentityId },
      async (transaction) => {
        await setCalendarOperation(transaction);
        const [actor, recipient] = await Promise.all([
          transaction.query.clinicUsers.findFirst({
            columns: { id: true },
            where: and(
              eq(clinicUsers.clinicId, input.clinicId),
              eq(clinicUsers.identityId, input.actorIdentityId),
              eq(clinicUsers.active, true),
            ),
          }),
          notificationRecipientForAppointment(
            transaction,
            input.clinicId,
            input.appointmentId,
            input.recipientContactId,
          ),
        ]);
        if (actor === undefined || recipient === undefined) {
          throw new Error(
            "No se pudo registrar el resultado del Mensaje de Cita",
          );
        }
        await transaction.insert(appointmentEvents).values({
          actorClinicUserId: actor.id,
          appointmentId: input.appointmentId,
          clinicId: input.clinicId,
          recipientContactId: recipient.id,
          type: messageEventType(input.type, input.result),
        });
      },
    );
  },

  async listFormData(input) {
    return readManualAppointmentFormData(input);
  },

  async listAppointments(input) {
    return readAppointments(input, input.status);
  },

  async listCalendar(input) {
    return readPanaceaCalendar(input);
  },

  async listCalendarDoctors(input) {
    return readCalendarDoctors(input);
  },
};

async function readManualAppointmentFormData(input: {
  clinicId: string;
  identityId: string;
}) {
  return inClinicTransaction(input, async (transaction) => {
    await setCalendarOperation(transaction);
    const [linkedPatients, activeOffers] = await Promise.all([
      transaction
        .select({
          contactId: contacts.id,
          contactName: contacts.name,
          contactPhoneE164: contacts.phoneE164,
          patientId: patients.id,
          patientName: patients.name,
        })
        .from(patients)
        .innerJoin(
          contactPatientLinks,
          and(
            eq(patients.clinicId, contactPatientLinks.clinicId),
            eq(patients.id, contactPatientLinks.patientId),
          ),
        )
        .innerJoin(
          contacts,
          and(
            eq(contactPatientLinks.clinicId, contacts.clinicId),
            eq(contactPatientLinks.contactId, contacts.id),
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
          linkedPatients.map((patient) => [
            patient.patientId,
            {
              contacts: linkedPatients
                .filter(
                  (candidate) => candidate.patientId === patient.patientId,
                )
                .map((candidate) => ({
                  id: candidate.contactId,
                  name: candidate.contactName,
                  phoneE164: candidate.contactPhoneE164,
                })),
              id: patient.patientId,
              name: patient.patientName,
            },
          ]),
        ).values(),
      ],
    };
  });
}

async function readAppointments(
  input: { clinicId: string; identityId: string },
  status: "confirmed" | "cancelled",
  period?: { doctorId?: string; from: Date; to: Date },
) {
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
        occupiedUntil: appointments.occupiedUntil,
        origin: appointments.origin,
        outsideSchedule: appointments.outsideSchedule,
        patientId: patients.id,
        patientName: patients.name,
        priceUsd: appointments.priceUsd,
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
          eq(appointments.status, status),
          status === "cancelled"
            ? eq(appointments.origin, "manual")
            : undefined,
          period === undefined
            ? undefined
            : or(
                gt(appointments.endsAt, period.from),
                gt(appointments.occupiedUntil, period.from),
              ),
          period === undefined
            ? undefined
            : lt(appointments.startsAt, period.to),
          period?.doctorId === undefined
            ? undefined
            : eq(appointments.doctorId, period.doctorId),
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
          actorContactId: appointmentEvents.actorContactId,
          actorClinicUserId: appointmentEvents.actorClinicUserId,
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
      endsAt: appointment.endsAt,
      events: events
        .filter((event) => event.appointmentId === appointment.id)
        .map(({ appointmentId: _, recipientContactId, ...event }) => {
          const recipient = linkedContacts.find(
            (contact) => contact.id === recipientContactId,
          );
          return {
            ...event,
            recipient:
              recipient === undefined
                ? null
                : {
                    id: recipient.id,
                    name: recipient.name,
                    phoneE164: recipient.phoneE164,
                  },
          };
        }),
      id: appointment.id,
      occupiedUntil: appointment.occupiedUntil ?? appointment.endsAt,
      origin: appointment.origin,
      outsideSchedule: appointment.outsideSchedule,
      patient: { id: appointment.patientId, name: appointment.patientName },
      priceUsd: appointment.priceUsd,
      service: { name: appointment.serviceName },
      startsAt: appointment.startsAt,
      status: appointment.status,
    }));
  });
}

async function readPanaceaCalendar(input: PanaceaCalendarInput) {
  const [activeAppointments, blocks] = await Promise.all([
    readAppointments(input, "confirmed", input),
    readAvailabilityBlocks(input),
  ]);
  return [...activeAppointments, ...blocks].sort(
    (left, right) => left.startsAt.valueOf() - right.startsAt.valueOf(),
  );
}

async function readCalendarDoctors(input: {
  clinicId: string;
  identityId: string;
}) {
  return inClinicTransaction(input, async (transaction) => {
    await setCalendarOperation(transaction);
    const doctorsInClinic = await transaction
      .select({
        id: doctors.id,
        name: doctors.publicName,
      })
      .from(doctors)
      .innerJoin(
        clinicUsers,
        and(
          eq(doctors.clinicId, clinicUsers.clinicId),
          eq(doctors.clinicUserId, clinicUsers.id),
        ),
      )
      .where(
        and(
          eq(doctors.clinicId, input.clinicId),
          eq(doctors.active, true),
          eq(clinicUsers.active, true),
          inArray(clinicUsers.role, ["owner", "doctor"]),
        ),
      )
      .orderBy(asc(doctors.publicName), asc(doctors.createdAt));

    return doctorsInClinic.map((doctor) => ({
      id: doctor.id,
      name: doctor.name ?? "Médico sin nombre público",
    }));
  });
}

async function readAvailabilityBlocks(input: PanaceaCalendarInput) {
  return inClinicTransaction(input, async (transaction) => {
    await setCalendarOperation(transaction);
    const blocks = await transaction
      .select({
        doctorId: doctors.id,
        doctorName: doctors.publicName,
        endsAt: availabilityBlocks.endsAt,
        id: availabilityBlocks.id,
        privateLabel: availabilityBlocks.privateLabel,
        startsAt: availabilityBlocks.startsAt,
      })
      .from(availabilityBlocks)
      .innerJoin(
        doctors,
        and(
          eq(availabilityBlocks.clinicId, doctors.clinicId),
          eq(availabilityBlocks.doctorId, doctors.id),
        ),
      )
      .where(
        and(
          eq(availabilityBlocks.clinicId, input.clinicId),
          gt(availabilityBlocks.endsAt, input.from),
          lt(availabilityBlocks.startsAt, input.to),
          input.doctorId === undefined
            ? undefined
            : eq(availabilityBlocks.doctorId, input.doctorId),
        ),
      )
      .orderBy(asc(availabilityBlocks.startsAt));
    return blocks.map((block) => ({
      doctor: {
        id: block.doctorId,
        name: block.doctorName ?? "Médico sin nombre público",
      },
      endsAt: block.endsAt,
      id: block.id,
      privateLabel: block.privateLabel,
      startsAt: block.startsAt,
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
  const [actor, offer, linkedContacts] = await Promise.all([
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
    transaction
      .select({
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
          eq(contactPatientLinks.patientId, input.patientId),
        ),
      ),
  ]);
  const selectedOffer = offer[0];
  const notificationRecipient =
    input.notificationRecipientContactId === undefined
      ? undefined
      : linkedContacts.find(
          (contact) => contact.id === input.notificationRecipientContactId,
        );
  if (
    actor === undefined ||
    selectedOffer === undefined ||
    linkedContacts.length === 0 ||
    (input.notificationRecipientContactId !== undefined &&
      notificationRecipient === undefined)
  ) {
    return undefined;
  }

  return {
    ...selectedOffer,
    actorClinicUserId: actor.id,
    notificationRecipient,
  };
}

async function notificationRecipientForAppointment(
  transaction: ClinicTransaction,
  clinicId: string,
  appointmentId: string,
  recipientContactId: string | undefined,
) {
  if (recipientContactId === undefined) return undefined;
  const [recipient] = await transaction
    .select({
      id: contacts.id,
      name: contacts.name,
      phoneE164: contacts.phoneE164,
    })
    .from(appointments)
    .innerJoin(
      contactPatientLinks,
      and(
        eq(appointments.clinicId, contactPatientLinks.clinicId),
        eq(appointments.patientId, contactPatientLinks.patientId),
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
        eq(appointments.clinicId, clinicId),
        eq(appointments.id, appointmentId),
        eq(contacts.id, recipientContactId),
      ),
    );
  return recipient;
}

function messageEventType(
  type: ManualAppointmentMessageType,
  result: "sent" | "failed",
) {
  return `${type}-${result}` as const;
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
