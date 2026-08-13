import { and, eq, gt, gte, inArray, lt, lte } from "drizzle-orm";

import {
  appointmentReminderCheckpoints,
  type AppointmentReminderCheckpoint,
  type AppointmentReminderCallbackStore,
  type AppointmentSchedulerStore,
} from "~/server/application/appointment-reminders";
import { inAppointmentSchedulerTransaction } from "~/server/db/clinic-context";
import {
  appointmentEvents,
  appointments,
  clinicUsers,
  clinics,
  contactPatientLinks,
  dailyAgendaEmails,
  doctors,
  patients,
  simulatedWhatsAppMessages,
  temporaryReservations,
  user,
} from "~/server/db/schema";
import type { db } from "~/server/db";

type SchedulerTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const REMINDER_CATCH_UP_MS = 15 * 60_000;
const HOUR_MS = 60 * 60_000;

/** Persistencia RLS del planificador de Reservas, recordatorios y silencio. */
export const drizzleAppointmentSchedulerStore: AppointmentSchedulerStore = {
  async releaseExpiredReservations({ now }) {
    return inAppointmentSchedulerTransaction(async (transaction) => {
      const released = await transaction
        .delete(temporaryReservations)
        .where(lte(temporaryReservations.expiresAt, now))
        .returning({ id: temporaryReservations.id });
      return released.length;
    });
  },

  async claimDueReminders({ now }) {
    return inAppointmentSchedulerTransaction(async (transaction) => {
      const candidates = await transaction
        .select({
          appointmentId: appointments.id,
          authorContactId: appointments.authorContactId,
          clinicId: appointments.clinicId,
          startsAt: appointments.startsAt,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.status, "confirmed"),
            gte(appointments.startsAt, new Date(now.valueOf() + 19 * HOUR_MS)),
            lte(appointments.startsAt, new Date(now.valueOf() + 24 * HOUR_MS)),
          ),
        );
      const claims: Array<{
        appointmentId: string;
        checkpoint: AppointmentReminderCheckpoint;
        clinicId: string;
        identityId: string;
      }> = [];
      for (const appointment of candidates) {
        const owner = await activeOwnerIdentity(
          transaction,
          appointment.clinicId,
        );
        if (owner === undefined) continue;
        for (const checkpoint of appointmentReminderCheckpoints) {
          const scheduledAt = new Date(
            appointment.startsAt.valueOf() -
              checkpointHours(checkpoint) * HOUR_MS,
          );
          if (
            scheduledAt > now ||
            now.valueOf() - scheduledAt.valueOf() > REMINDER_CATCH_UP_MS
          ) {
            continue;
          }
          const [claim] = await transaction
            .insert(appointmentEvents)
            .values({
              actorClinicUserId: owner.clinicUserId,
              appointmentId: appointment.appointmentId,
              clinicId: appointment.clinicId,
              occurredAt: now,
              reason: checkpoint,
              type: "reminder-claimed",
            })
            .onConflictDoNothing()
            .returning({ id: appointmentEvents.id });
          if (claim !== undefined) {
            claims.push({
              appointmentId: appointment.appointmentId,
              checkpoint,
              clinicId: appointment.clinicId,
              identityId: owner.identityId,
            });
          }
        }
      }
      return claims;
    });
  },

  async applyNoShowPolicy({ now }) {
    return inAppointmentSchedulerTransaction(async (transaction) => {
      const candidates = await transaction
        .select({
          appointmentId: appointments.id,
          authorContactId: appointments.authorContactId,
          clinicId: appointments.clinicId,
          noShowPolicy: clinics.noShowPolicy,
          patientId: appointments.patientId,
          startsAt: appointments.startsAt,
        })
        .from(appointments)
        .innerJoin(clinics, eq(appointments.clinicId, clinics.id))
        .where(
          and(
            eq(appointments.status, "confirmed"),
            gte(appointments.startsAt, new Date(now.valueOf() + 19 * HOUR_MS)),
            lte(appointments.startsAt, new Date(now.valueOf() + 20 * HOUR_MS)),
          ),
        );
      let alerted = 0;
      let cancelled = 0;
      for (const appointment of candidates) {
        const owner = await activeOwnerIdentity(
          transaction,
          appointment.clinicId,
        );
        if (owner === undefined) continue;
        if (
          !(await hasHealthySilentReminderCadence(transaction, appointment))
        ) {
          continue;
        }
        const outcomeType =
          appointment.noShowPolicy === "cancel-after-third-reminder"
            ? "no-show-auto-cancelled"
            : "no-show-alerted";
        const [outcome] = await transaction
          .insert(appointmentEvents)
          .values({
            actorClinicUserId: owner.clinicUserId,
            appointmentId: appointment.appointmentId,
            clinicId: appointment.clinicId,
            occurredAt: now,
            type: outcomeType,
          })
          .onConflictDoNothing()
          .returning({ id: appointmentEvents.id });
        if (outcome === undefined) continue;
        if (outcomeType === "no-show-auto-cancelled") {
          await transaction
            .update(appointments)
            .set({ status: "cancelled" })
            .where(
              and(
                eq(appointments.id, appointment.appointmentId),
                eq(appointments.status, "confirmed"),
              ),
            );
          cancelled += 1;
        } else {
          alerted += 1;
        }
      }
      return { alerted, cancelled };
    });
  },

  async claimDailyAgendaEmails({ now }) {
    // El piloto usa America/El_Salvador (UTC-6 sin horario de verano).
    if (now.getUTCHours() !== 8) return [];
    return inAppointmentSchedulerTransaction(async (transaction) => {
      const agendaDate = new Date(now.valueOf() - 6 * HOUR_MS)
        .toISOString()
        .slice(0, 10);
      const recipients = await transaction
        .select({
          clinicId: clinics.id,
          clinicName: clinics.name,
          doctorId: doctors.id,
          doctorName: doctors.publicName,
          recipientEmail: user.email,
        })
        .from(doctors)
        .innerJoin(clinics, eq(doctors.clinicId, clinics.id))
        .innerJoin(
          clinicUsers,
          and(
            eq(doctors.clinicId, clinicUsers.clinicId),
            eq(doctors.clinicUserId, clinicUsers.id),
          ),
        )
        .innerJoin(user, eq(clinicUsers.identityId, user.id))
        .where(and(eq(doctors.active, true), eq(clinicUsers.active, true)));
      const agendas = [];
      for (const recipient of recipients) {
        const [claim] = await transaction
          .insert(dailyAgendaEmails)
          .values({
            agendaDate,
            clinicId: recipient.clinicId,
            doctorId: recipient.doctorId,
            sentAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: dailyAgendaEmails.id });
        if (claim === undefined) continue;
        const agenda = await transaction
          .select({
            patientName: patients.name,
            startsAt: appointments.startsAt,
          })
          .from(appointments)
          .innerJoin(
            patients,
            and(
              eq(appointments.clinicId, patients.clinicId),
              eq(appointments.patientId, patients.id),
            ),
          )
          .where(
            and(
              eq(appointments.clinicId, recipient.clinicId),
              eq(appointments.doctorId, recipient.doctorId),
              eq(appointments.status, "confirmed"),
              gte(appointments.startsAt, now),
              lt(
                appointments.startsAt,
                new Date(now.valueOf() + 7 * 24 * HOUR_MS),
              ),
            ),
          );
        agendas.push({
          agenda,
          clinicName: recipient.clinicName,
          doctorName: recipient.doctorName ?? "Médico sin nombre público",
          recipientEmail: recipient.recipientEmail,
        });
      }
      return agendas;
    });
  },
};

/** Adaptador de callback del proveedor simulado, acotado por Clínica y Cita. */
export const drizzleAppointmentReminderCallbackStore: AppointmentReminderCallbackStore =
  {
    async recordCallback(input) {
      await inAppointmentSchedulerTransaction(async (transaction) => {
        const reminder = await transaction.query.appointmentEvents.findFirst({
          columns: { id: true },
          where: and(
            eq(appointmentEvents.clinicId, input.clinicId),
            eq(appointmentEvents.appointmentId, input.appointmentId),
            eq(appointmentEvents.recipientContactId, input.recipientContactId),
            eq(appointmentEvents.reason, input.checkpoint),
            eq(appointmentEvents.type, "reminder-sent"),
          ),
        });
        if (reminder === undefined) {
          throw new Error(
            "El callback no corresponde a un recordatorio enviado",
          );
        }
        const owner = await activeOwnerIdentity(transaction, input.clinicId);
        if (owner === undefined) {
          throw new Error("No hay Médico propietario activo para el callback");
        }
        await transaction
          .insert(appointmentEvents)
          .values({
            actorClinicUserId: owner.clinicUserId,
            appointmentId: input.appointmentId,
            clinicId: input.clinicId,
            reason: input.checkpoint,
            recipientContactId: input.recipientContactId,
            type:
              input.status === "delivered"
                ? "reminder-delivered"
                : "reminder-delivery-failed",
          })
          .onConflictDoNothing();
      });
    },
  };

async function activeOwnerIdentity(
  transaction: SchedulerTransaction,
  clinicId: string,
) {
  return transaction.query.clinicUsers
    .findFirst({
      columns: { id: true, identityId: true },
      where: and(
        eq(clinicUsers.clinicId, clinicId),
        eq(clinicUsers.role, "owner"),
        eq(clinicUsers.active, true),
      ),
    })
    .then((owner) =>
      owner === undefined
        ? undefined
        : { clinicUserId: owner.id, identityId: owner.identityId },
    );
}

async function hasHealthySilentReminderCadence(
  transaction: SchedulerTransaction,
  appointment: {
    appointmentId: string;
    authorContactId: string | null;
    clinicId: string;
    patientId: string | null;
    startsAt: Date;
  },
) {
  const events = await transaction
    .select({
      occurredAt: appointmentEvents.occurredAt,
      reason: appointmentEvents.reason,
    })
    .from(appointmentEvents)
    .where(
      and(
        eq(appointmentEvents.clinicId, appointment.clinicId),
        eq(appointmentEvents.appointmentId, appointment.appointmentId),
        eq(appointmentEvents.type, "reminder-sent"),
      ),
    );
  const confirmation = await transaction.query.appointmentEvents.findFirst({
    columns: { occurredAt: true },
    where: and(
      eq(appointmentEvents.clinicId, appointment.clinicId),
      eq(appointmentEvents.appointmentId, appointment.appointmentId),
      inArray(appointmentEvents.type, [
        "manual-created",
        "reservation-confirmed",
      ]),
    ),
  });
  if (confirmation === undefined) return false;
  const reply =
    appointment.patientId === null
      ? undefined
      : await transaction
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
              eq(simulatedWhatsAppMessages.clinicId, appointment.clinicId),
              eq(contactPatientLinks.patientId, appointment.patientId),
              gt(simulatedWhatsAppMessages.createdAt, confirmation.occurredAt),
            ),
          )
          .limit(1)
          .then((messages) => messages[0]);
  if (reply !== undefined) return false;
  return appointmentReminderCheckpoints.every((checkpoint) =>
    events.some(
      (event) =>
        event.reason === checkpoint &&
        Math.abs(
          event.occurredAt.valueOf() -
            (appointment.startsAt.valueOf() -
              checkpointHours(checkpoint) * HOUR_MS),
        ) <= REMINDER_CATCH_UP_MS,
    ),
  );
}

function checkpointHours(checkpoint: AppointmentReminderCheckpoint) {
  return Number.parseInt(checkpoint, 10);
}
