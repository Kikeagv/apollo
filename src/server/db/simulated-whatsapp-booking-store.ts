import { and, eq, gt, lt, sql } from "drizzle-orm";

import { CLINIC_UTC_OFFSET } from "~/clinic-timezone";
import {
  calculateCareOptionsFromInputs,
  type CareOptionInputs,
} from "~/server/application/care-options";
import type {
  BookingConversation,
  PublicOffer,
  SimulatedWhatsAppBookingStore,
} from "~/server/application/simulated-whatsapp-booking";
import type { AppointmentSelfManagementStore } from "~/server/application/appointment-self-management";
import { readAgendaCapacity } from "~/server/db/agenda-capacity-store";
import {
  inSimulatedWhatsAppClinicTransaction,
  inSimulatedWhatsAppInboundTransaction,
} from "~/server/db/clinic-context";
import type { db } from "~/server/db";
import {
  appointmentEvents,
  appointments,
  clinicUsers,
  contactPatientLinks,
  contacts,
  doctors,
  patients,
  serviceOffers,
  services,
  simulatedWhatsAppMessages,
  temporaryReservations,
  whatsappConversations,
} from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const EMPTY_CONVERSATION: BookingConversation = {
  reservationId: null,
  selectedOfferId: null,
  selectedPatientId: null,
};

/** Adaptador PostgreSQL del transporte simulado; conserva RLS e idempotencia. */
export const drizzleSimulatedWhatsAppBookingStore: SimulatedWhatsAppBookingStore =
  {
    async beginMessage(input) {
      return inSimulatedWhatsAppInboundTransaction(
        input.to,
        async (context, transaction) => {
          const contact = await transaction.query.contacts.findFirst({
            columns: { id: true },
            where: and(
              eq(contacts.clinicId, context.clinicId),
              eq(contacts.phoneE164, input.from),
            ),
          });
          if (contact === undefined) return undefined;
          const [created] = await transaction
            .insert(simulatedWhatsAppMessages)
            .values({
              clinicId: context.clinicId,
              contactId: contact.id,
              id: input.id,
            })
            .onConflictDoNothing()
            .returning({ id: simulatedWhatsAppMessages.id });
          if (created !== undefined) {
            return { ...context, contactId: contact.id, duplicate: null };
          }
          const existing =
            await transaction.query.simulatedWhatsAppMessages.findFirst({
              columns: { response: true },
              where: and(
                eq(simulatedWhatsAppMessages.clinicId, context.clinicId),
                eq(simulatedWhatsAppMessages.id, input.id),
              ),
            });
          if (existing?.response === null || existing?.response === undefined) {
            throw new Error("El mensaje simulado ya está siendo procesado");
          }
          return {
            ...context,
            contactId: contact.id,
            duplicate: hydrateStoredResponse(existing.response),
          };
        },
      );
    },

    async completeMessage(input) {
      await inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        (transaction) =>
          transaction
            .update(simulatedWhatsAppMessages)
            .set({ response: input.response })
            .where(
              and(
                eq(simulatedWhatsAppMessages.clinicId, input.clinicId),
                eq(simulatedWhatsAppMessages.id, input.id),
              ),
            ),
      );
    },

    async getConversation(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          const conversation =
            await transaction.query.whatsappConversations.findFirst({
              columns: { state: true },
              where: and(
                eq(whatsappConversations.clinicId, input.clinicId),
                eq(whatsappConversations.contactId, input.contactId),
              ),
            });
          return conversation?.state ?? EMPTY_CONVERSATION;
        },
      );
    },

    async saveConversation(input) {
      await inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        (transaction) =>
          transaction
            .insert(whatsappConversations)
            .values({
              clinicId: input.clinicId,
              contactId: input.contactId,
              state: input.conversation,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              set: { state: input.conversation, updatedAt: new Date() },
              target: [
                whatsappConversations.clinicId,
                whatsappConversations.contactId,
              ],
            }),
      );
    },

    async listLinkedPatients(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) =>
          transaction
            .select({
              birthDate: patients.birthDate,
              id: patients.id,
              name: patients.name,
            })
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
              ),
            )
            .then((rows) =>
              rows.flatMap((row) =>
                row.birthDate === null
                  ? []
                  : [{ ...row, birthDate: row.birthDate }],
              ),
            ),
      );
    },

    async listPublicOffers(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          const offers = await transaction
            .select({
              doctorId: doctors.id,
              doctorName: doctors.publicName,
              id: serviceOffers.id,
              priceUsd: serviceOffers.priceUsd,
              serviceName: services.name,
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
              ),
            );
          return offers.map(
            (offer) =>
              ({
                ...offer,
                doctorName: offer.doctorName ?? "Médico sin nombre público",
                priceUsd: offer.priceUsd,
              }) satisfies PublicOffer,
          );
        },
      );
    },

    async registerAdult(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          const [patient] = await transaction
            .insert(patients)
            .values({
              birthDate: input.birthDate,
              clinicId: input.clinicId,
              dui: input.dui,
              name: input.name,
            })
            .returning({
              birthDate: patients.birthDate,
              id: patients.id,
              name: patients.name,
            });
          if (patient?.birthDate == null) {
            throw new Error("No se pudo registrar el Paciente adulto");
          }
          await transaction.insert(contactPatientLinks).values({
            clinicId: input.clinicId,
            contactId: input.contactId,
            patientId: patient.id,
            relationship: "contact",
          });
          return {
            birthDate: patient.birthDate,
            id: patient.id,
            name: patient.name,
          };
        },
      );
    },

    async registerMinor(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          const [patient] = await transaction
            .insert(patients)
            .values({
              birthDate: input.birthDate,
              clinicId: input.clinicId,
              name: input.name,
            })
            .returning({
              birthDate: patients.birthDate,
              id: patients.id,
              name: patients.name,
            });
          if (patient?.birthDate == null) {
            throw new Error("No se pudo registrar el Paciente menor");
          }
          await transaction.insert(contactPatientLinks).values({
            clinicId: input.clinicId,
            contactId: input.contactId,
            guardianDui: input.guardianDui,
            guardianshipVerificationStatus: "pending",
            patientId: patient.id,
            relationship: "tutor",
          });
          return {
            birthDate: patient.birthDate,
            id: patient.id,
            name: patient.name,
          };
        },
      );
    },

    async listCareOptions(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          if (!(await linkedPatientExists(transaction, input)))
            return undefined;
          const offer = await activeOffer(
            transaction,
            input.clinicId,
            input.offerId,
          );
          if (offer === undefined) return undefined;
          const options = await agendaOptions(transaction, {
            clinicId: input.clinicId,
            doctorId: offer.doctorId,
            now: input.now,
            offer,
            on: input.on,
          });
          return options.map((option) => option.startsAt);
        },
      );
    },

    async holdReservation(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          const offer = await activeOffer(
            transaction,
            input.clinicId,
            input.offerId,
          );
          if (
            offer === undefined ||
            !(await linkedPatientExists(transaction, input))
          )
            return undefined;
          await lockDoctor(transaction, offer.doctorId);
          const options = await agendaOptions(transaction, {
            clinicId: input.clinicId,
            doctorId: offer.doctorId,
            now: input.now,
            offer,
            on: localDate(input.startsAt),
          });
          if (
            !options.some(
              (option) =>
                option.startsAt.valueOf() === input.startsAt.valueOf(),
            )
          )
            return undefined;
          const endsAt = addMinutes(
            input.startsAt,
            offer.durationMinutes + offer.bufferMinutes,
          );
          const expiresAt = new Date(input.now.valueOf() + 10 * 60_000);
          const [reservation] = await transaction
            .insert(temporaryReservations)
            .values({
              clinicId: input.clinicId,
              contactId: input.contactId,
              doctorId: offer.doctorId,
              endsAt,
              expiresAt,
              patientId: input.patientId,
              serviceOfferId: input.offerId,
              startsAt: input.startsAt,
            })
            .returning({
              expiresAt: temporaryReservations.expiresAt,
              id: temporaryReservations.id,
            });
          return reservation;
        },
      );
    },

    async confirmReservation(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          const initialReservation =
            await transaction.query.temporaryReservations.findFirst({
              columns: {
                contactId: true,
                doctorId: true,
                expiresAt: true,
                id: true,
                patientId: true,
                serviceOfferId: true,
                startsAt: true,
              },
              where: and(
                eq(temporaryReservations.clinicId, input.clinicId),
                eq(temporaryReservations.id, input.reservationId),
                eq(temporaryReservations.contactId, input.contactId),
                gt(temporaryReservations.expiresAt, input.now),
              ),
            });
          if (initialReservation === undefined) return undefined;
          await lockDoctor(transaction, initialReservation.doctorId);
          const [reservation] = await transaction
            .delete(temporaryReservations)
            .where(
              and(
                eq(temporaryReservations.clinicId, input.clinicId),
                eq(temporaryReservations.id, input.reservationId),
                eq(temporaryReservations.contactId, input.contactId),
                gt(temporaryReservations.expiresAt, input.now),
              ),
            )
            .returning({
              doctorId: temporaryReservations.doctorId,
              patientId: temporaryReservations.patientId,
              serviceOfferId: temporaryReservations.serviceOfferId,
              startsAt: temporaryReservations.startsAt,
            });
          if (
            reservation?.patientId == null ||
            reservation.serviceOfferId == null
          )
            return undefined;
          const offer = await activeOffer(
            transaction,
            input.clinicId,
            reservation.serviceOfferId,
          );
          if (offer === undefined) return undefined;
          const endsAt = addMinutes(
            reservation.startsAt,
            offer.durationMinutes,
          );
          const occupiedUntil = addMinutes(endsAt, offer.bufferMinutes);
          const [appointment] = await transaction
            .insert(appointments)
            .values({
              authorContactId: input.contactId,
              bufferMinutes: offer.bufferMinutes,
              clinicId: input.clinicId,
              doctorId: reservation.doctorId,
              durationMinutes: offer.durationMinutes,
              endsAt,
              occupiedUntil,
              origin: "reservation",
              patientId: reservation.patientId,
              priceUsd: offer.priceUsd,
              serviceOfferId: reservation.serviceOfferId,
              startsAt: reservation.startsAt,
            })
            .returning({
              id: appointments.id,
              patientId: appointments.patientId,
            });
          if (appointment?.patientId == null) return undefined;
          await transaction.insert(appointmentEvents).values({
            actorContactId: input.contactId,
            appointmentId: appointment.id,
            clinicId: input.clinicId,
            type: "reservation-confirmed",
          });
          return {
            id: appointment.id,
            origin: "reservation" as const,
            patientId: appointment.patientId,
          };
        },
      );
    },

    async cancelAppointment(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          const [appointment] = await transaction
            .update(appointments)
            .set({ status: "cancelled" })
            .where(
              and(
                eq(appointments.clinicId, input.clinicId),
                eq(appointments.id, input.appointmentId),
                eq(appointments.patientId, input.patientId),
                eq(appointments.authorContactId, input.contactId),
                eq(appointments.status, "confirmed"),
                gt(appointments.startsAt, input.now),
                lt(
                  appointments.startsAt,
                  new Date(input.now.valueOf() + 12 * 60 * 60_000),
                ),
              ),
            )
            .returning({ id: appointments.id });
          if (appointment === undefined) return undefined;
          await transaction.insert(appointmentEvents).values({
            actorContactId: input.contactId,
            appointmentId: appointment.id,
            clinicId: input.clinicId,
            type: "cancelled",
          });
          return appointment;
        },
      );
    },
  };

/** Consulta de autorización para los futuros comandos de autogestión de Asclepio. */
export const drizzleAppointmentSelfManagementStore: AppointmentSelfManagementStore =
  {
    async isAppointmentAuthor(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) =>
          (await transaction.query.appointments.findFirst({
            columns: { id: true },
            where: and(
              eq(appointments.clinicId, input.clinicId),
              eq(appointments.id, input.appointmentId),
              eq(appointments.authorContactId, input.contactId),
              eq(appointments.status, "confirmed"),
            ),
          })) !== undefined,
      );
    },
  };

async function activeOffer(
  transaction: ClinicTransaction,
  clinicId: string,
  offerId: string,
) {
  const [offer] = await transaction
    .select({
      bufferMinutes: serviceOffers.bufferMinutes,
      doctorId: serviceOffers.doctorId,
      durationMinutes: serviceOffers.durationMinutes,
      priceUsd: serviceOffers.priceUsd,
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
    .where(
      and(
        eq(serviceOffers.clinicId, clinicId),
        eq(serviceOffers.id, offerId),
        eq(serviceOffers.active, true),
        eq(doctors.active, true),
        eq(clinicUsers.active, true),
      ),
    );
  return offer;
}

async function linkedPatientExists(
  transaction: ClinicTransaction,
  input: { clinicId: string; contactId: string; patientId: string },
) {
  return (
    (await transaction.query.contactPatientLinks.findFirst({
      columns: { id: true },
      where: and(
        eq(contactPatientLinks.clinicId, input.clinicId),
        eq(contactPatientLinks.contactId, input.contactId),
        eq(contactPatientLinks.patientId, input.patientId),
      ),
    })) !== undefined
  );
}

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

function addMinutes(date: Date, minutes: number) {
  return new Date(date.valueOf() + minutes * 60_000);
}

function lockDoctor(transaction: ClinicTransaction, doctorId: string) {
  return transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext(${doctorId}))`,
  );
}

function hydrateStoredResponse(
  response: NonNullable<typeof simulatedWhatsAppMessages.$inferSelect.response>,
) {
  if (response.kind === "care-options") {
    return {
      ...response,
      options: response.options.map((option) => new Date(option)),
    };
  }
  if (response.kind === "reservation-held") {
    return { ...response, expiresAt: new Date(response.expiresAt) };
  }
  return response;
}
