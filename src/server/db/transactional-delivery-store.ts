import { and, eq, gt, gte, isNull, lt, lte, or, sql } from "drizzle-orm";

import {
  appointmentReminderCheckpoints,
  type AppointmentReminderCheckpoint,
} from "~/server/application/appointment-reminders";
import {
  retryAt,
  type TransactionalDeliveryCallbackStore,
  type TransactionalDelivery,
  type TransactionalDeliveryStore,
} from "~/server/application/transactional-deliveries";
import {
  inAppointmentSchedulerTransaction,
  inClinicTransaction,
} from "~/server/db/clinic-context";
import type { db } from "~/server/db";
import {
  appointmentEvents,
  appointments,
  clinicUsers,
  clinics,
  contactPatientLinks,
  contacts,
  doctors,
  patients,
  transactionalDeliveries,
  transactionalDeliveryAlerts,
  transactionalDeliveryAttempts,
  user,
} from "~/server/db/schema";

type SchedulerTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const HOUR_MS = 60 * 60_000;
const LEASE_MS = 10 * 60_000;
const RETAIN_MS = 365 * 24 * HOUR_MS;
const REMINDER_CATCH_UP_MS = 15 * 60_000;

/** Persistencia del outbox y sus concesiones, siempre bajo RLS del worker. */
export const drizzleTransactionalDeliveryStore: TransactionalDeliveryStore = {
  async claimReadyDeliveries({ now }) {
    return inAppointmentSchedulerTransaction(async (transaction) => {
      const candidates = await transaction
        .select()
        .from(transactionalDeliveries)
        .where(
          or(
            and(
              eq(transactionalDeliveries.status, "pending"),
              lte(transactionalDeliveries.nextAttemptAt, now),
            ),
            and(
              eq(transactionalDeliveries.status, "processing"),
              lte(transactionalDeliveries.leaseExpiresAt, now),
            ),
          ),
        );
      const claimed: TransactionalDelivery[] = [];
      for (const candidate of candidates) {
        const [delivery] = await transaction
          .update(transactionalDeliveries)
          .set({
            attempts: candidate.attempts + 1,
            leaseExpiresAt: new Date(now.valueOf() + LEASE_MS),
            status: "processing",
            updatedAt: now,
          })
          .where(
            and(
              eq(transactionalDeliveries.id, candidate.id),
              or(
                and(
                  eq(transactionalDeliveries.status, "pending"),
                  lte(transactionalDeliveries.nextAttemptAt, now),
                ),
                and(
                  eq(transactionalDeliveries.status, "processing"),
                  lte(transactionalDeliveries.leaseExpiresAt, now),
                ),
              ),
            ),
          )
          .returning();
        if (delivery !== undefined) claimed.push(toDelivery(delivery));
      }
      return claimed;
    });
  },

  async markDelivered({ delivery, now }) {
    await inAppointmentSchedulerTransaction(async (transaction) => {
      const [updated] = await transaction
        .update(transactionalDeliveries)
        .set({
          deliveredAt: now,
          leaseExpiresAt: null,
          status: "sent",
          updatedAt: now,
        })
        .where(
          and(
            eq(transactionalDeliveries.id, delivery.id),
            eq(transactionalDeliveries.status, "processing"),
            eq(transactionalDeliveries.attempts, delivery.attempts),
          ),
        )
        .returning({ id: transactionalDeliveries.id });
      if (updated === undefined) return;
      await transaction.insert(transactionalDeliveryAttempts).values({
        attempt: delivery.attempts,
        clinicId: delivery.clinicId,
        deliveryId: delivery.id,
        occurredAt: now,
        outcome: "delivered",
        retainUntil: new Date(now.valueOf() + RETAIN_MS),
      });
      if (delivery.kind !== "appointment-reminder") return;
      const owner = await activeOwner(transaction, delivery.clinicId);
      if (owner === undefined) return;
      await transaction.insert(appointmentEvents).values({
        actorClinicUserId: owner.id,
        appointmentId: delivery.payload.appointmentId,
        clinicId: delivery.clinicId,
        occurredAt: now,
        reason: delivery.payload.checkpoint,
        recipientContactId: delivery.payload.recipient.id,
        type: "reminder-sent",
      });
    });
  },

  async scheduleRetry({ delivery, error, now }) {
    await inAppointmentSchedulerTransaction(async (transaction) => {
      const nextAttemptAt = retryAt(delivery.attempts, now);
      if (nextAttemptAt !== undefined) {
        const [updated] = await transaction
          .update(transactionalDeliveries)
          .set({
            lastError: error.message.slice(0, 1_000),
            leaseExpiresAt: null,
            nextAttemptAt,
            status: "pending",
            updatedAt: now,
          })
          .where(
            and(
              eq(transactionalDeliveries.id, delivery.id),
              eq(transactionalDeliveries.status, "processing"),
              eq(transactionalDeliveries.attempts, delivery.attempts),
            ),
          )
          .returning({ id: transactionalDeliveries.id });
        if (updated === undefined) return;
        await transaction.insert(transactionalDeliveryAttempts).values({
          attempt: delivery.attempts,
          clinicId: delivery.clinicId,
          deliveryId: delivery.id,
          error: error.message.slice(0, 1_000),
          occurredAt: now,
          outcome: "failed",
          retainUntil: new Date(now.valueOf() + RETAIN_MS),
        });
        return;
      }
      const [updated] = await transaction
        .update(transactionalDeliveries)
        .set({
          lastError: error.message.slice(0, 1_000),
          leaseExpiresAt: null,
          status: "failed",
          updatedAt: now,
        })
        .where(
          and(
            eq(transactionalDeliveries.id, delivery.id),
            eq(transactionalDeliveries.status, "processing"),
            eq(transactionalDeliveries.attempts, delivery.attempts),
          ),
        )
        .returning({ id: transactionalDeliveries.id });
      if (updated === undefined) return;
      await transaction.insert(transactionalDeliveryAttempts).values({
        attempt: delivery.attempts,
        clinicId: delivery.clinicId,
        deliveryId: delivery.id,
        error: error.message.slice(0, 1_000),
        occurredAt: now,
        outcome: "failed",
        retainUntil: new Date(now.valueOf() + RETAIN_MS),
      });
      await transaction
        .insert(transactionalDeliveryAlerts)
        .values({
          clinicId: delivery.clinicId,
          deliveryId: delivery.id,
          retainUntil: new Date(now.valueOf() + RETAIN_MS),
        })
        .onConflictDoNothing();
    });
  },
};

export const drizzleTransactionalDeliveryCallbackStore: TransactionalDeliveryCallbackStore =
  {
    async recordProviderCallback(input) {
      await inAppointmentSchedulerTransaction(async (transaction) => {
        const delivery =
          await transaction.query.transactionalDeliveries.findFirst({
            columns: { clinicId: true, id: true, retainUntil: true },
            where: eq(
              transactionalDeliveries.idempotencyKey,
              input.idempotencyKey,
            ),
          });
        if (delivery === undefined)
          throw new Error(
            "El callback no corresponde a una Entrega transaccional",
          );
        await transaction
          .insert(transactionalDeliveryAttempts)
          .values({
            attempt: 0,
            clinicId: delivery.clinicId,
            deliveryId: delivery.id,
            outcome: "callback",
            providerStatus: input.status,
            retainUntil: delivery.retainUntil,
          })
          .onConflictDoNothing();
      });
    },
  };

/** Prepara decisiones de Agenda y las inserta de forma idempotente en el outbox. */
export async function enqueueDueTransactionalDeliveries(input: { now: Date }) {
  return inAppointmentSchedulerTransaction(async (transaction) => {
    let reminders = 0;
    for (const appointment of await dueAppointments(transaction, input.now)) {
      if (appointment.patientId === null) continue;
      for (const checkpoint of appointmentReminderCheckpoints) {
        const dueNow = isCheckpointDue(
          appointment.startsAt,
          checkpoint,
          input.now,
        );
        const preparingFutureCheckpoint =
          checkpoint !== "24h" &&
          isCheckpointDue(appointment.startsAt, "24h", input.now);
        if (!dueNow && !preparingFutureCheckpoint) continue;
        const recipients = await reminderRecipients(transaction, appointment);
        for (const recipient of recipients) {
          const [inserted] = await transaction
            .insert(transactionalDeliveries)
            .values({
              appointmentId: appointment.id,
              clinicId: appointment.clinicId,
              idempotencyKey: `${appointment.id}:${checkpoint}:${recipient.id}`,
              kind: "appointment-reminder",
              nextAttemptAt: new Date(
                appointment.startsAt.valueOf() -
                  Number.parseInt(checkpoint, 10) * HOUR_MS,
              ),
              payload: {
                appointmentId: appointment.id,
                appointmentStartsAt: appointment.startsAt,
                checkpoint,
                clinicName: appointment.clinicName,
                recipient,
              },
              recipientContactId: recipient.id,
              retainUntil: new Date(input.now.valueOf() + RETAIN_MS),
            })
            .onConflictDoNothing()
            .returning({ id: transactionalDeliveries.id });
          if (inserted !== undefined) reminders += 1;
        }
      }
    }
    const agendas = await enqueueDailyAgendas(transaction, input.now);
    return { agendas, reminders };
  });
}

export async function purgeExpiredTransactionalDeliveries(input: {
  now: Date;
}) {
  return inAppointmentSchedulerTransaction(async (transaction) =>
    transaction
      .delete(transactionalDeliveries)
      .where(lte(transactionalDeliveries.retainUntil, input.now))
      .returning({ id: transactionalDeliveries.id })
      .then((rows) => rows.length),
  );
}

/** Una respuesta del Contacto solo suprime futuros hitos pendientes. */
export async function suppressPendingReminderDeliveries(input: {
  clinicId: string;
  contactId: string;
  now: Date;
}) {
  return inAppointmentSchedulerTransaction(async (transaction) => {
    const activeTwentyFourHourDelivery = await transaction
      .select({ appointmentId: transactionalDeliveries.appointmentId })
      .from(transactionalDeliveries)
      .innerJoin(
        appointments,
        and(
          eq(transactionalDeliveries.clinicId, appointments.clinicId),
          eq(transactionalDeliveries.appointmentId, appointments.id),
        ),
      )
      .where(
        and(
          eq(transactionalDeliveries.clinicId, input.clinicId),
          eq(transactionalDeliveries.recipientContactId, input.contactId),
          eq(transactionalDeliveries.kind, "appointment-reminder"),
          eq(transactionalDeliveries.status, "sent"),
          gt(appointments.startsAt, input.now),
          sql`${transactionalDeliveries.payload}->>'checkpoint' = '24h'`,
        ),
      )
      .then((rows) => rows[0]);
    if (
      activeTwentyFourHourDelivery?.appointmentId === null ||
      activeTwentyFourHourDelivery === undefined
    )
      return 0;
    const rows = await transaction
      .update(transactionalDeliveries)
      .set({ status: "suppressed", updatedAt: input.now })
      .where(
        and(
          eq(transactionalDeliveries.clinicId, input.clinicId),
          eq(
            transactionalDeliveries.appointmentId,
            activeTwentyFourHourDelivery.appointmentId,
          ),
          eq(transactionalDeliveries.recipientContactId, input.contactId),
          eq(transactionalDeliveries.status, "pending"),
          sql`${transactionalDeliveries.payload}->>'checkpoint' IN ('22h', '20h')`,
        ),
      )
      .returning({ id: transactionalDeliveries.id });
    return rows.length;
  });
}

export type TransactionalDeliveryAlert = {
  createdAt: Date;
  delivery: { idempotencyKey: string; kind: string; lastError: string | null };
  id: string;
};

export async function listTransactionalDeliveryAlerts(input: {
  clinicId: string;
  identityId: string;
}): Promise<TransactionalDeliveryAlert[]> {
  return inClinicTransaction(input, async (transaction) =>
    transaction
      .select({
        createdAt: transactionalDeliveryAlerts.createdAt,
        deliveryIdempotencyKey: transactionalDeliveries.idempotencyKey,
        deliveryKind: transactionalDeliveries.kind,
        lastError: transactionalDeliveries.lastError,
        id: transactionalDeliveryAlerts.id,
      })
      .from(transactionalDeliveryAlerts)
      .innerJoin(
        transactionalDeliveries,
        eq(transactionalDeliveryAlerts.deliveryId, transactionalDeliveries.id),
      )
      .where(
        and(
          eq(transactionalDeliveryAlerts.clinicId, input.clinicId),
          isNull(transactionalDeliveryAlerts.resolvedAt),
        ),
      )
      .then((alerts) =>
        alerts.map((alert) => ({
          createdAt: alert.createdAt,
          delivery: {
            idempotencyKey: alert.deliveryIdempotencyKey,
            kind: alert.deliveryKind,
            lastError: alert.lastError,
          },
          id: alert.id,
        })),
      ),
  );
}

export async function resolveTransactionalDeliveryAlert(input: {
  alertId: string;
  clinicId: string;
  identityId: string;
  now: Date;
}) {
  return inClinicTransaction(input, async (transaction) => {
    const member = await transaction.query.clinicUsers.findFirst({
      columns: { id: true },
      where: and(
        eq(clinicUsers.clinicId, input.clinicId),
        eq(clinicUsers.identityId, input.identityId),
        eq(clinicUsers.active, true),
      ),
    });
    if (member === undefined) return false;
    const [alert] = await transaction
      .update(transactionalDeliveryAlerts)
      .set({ resolvedAt: input.now, resolvedByClinicUserId: member.id })
      .where(
        and(
          eq(transactionalDeliveryAlerts.id, input.alertId),
          eq(transactionalDeliveryAlerts.clinicId, input.clinicId),
          isNull(transactionalDeliveryAlerts.resolvedAt),
        ),
      )
      .returning({ id: transactionalDeliveryAlerts.id });
    return alert !== undefined;
  });
}

/** Adaptador explícito para que Pendientes delegue la resolución de Entregas. */
export const drizzleTransactionalDeliveryAlertResolver = {
  resolveTransactionalDeliveryAlert,
};

async function dueAppointments(transaction: SchedulerTransaction, now: Date) {
  return transaction
    .select({
      authorContactId: appointments.authorContactId,
      clinicId: appointments.clinicId,
      clinicName: clinics.name,
      id: appointments.id,
      origin: appointments.origin,
      patientId: appointments.patientId,
      startsAt: appointments.startsAt,
    })
    .from(appointments)
    .innerJoin(clinics, eq(appointments.clinicId, clinics.id))
    .where(
      and(
        eq(appointments.status, "confirmed"),
        gte(appointments.startsAt, new Date(now.valueOf() + 19 * HOUR_MS)),
        lte(appointments.startsAt, new Date(now.valueOf() + 24 * HOUR_MS)),
      ),
    );
}

async function reminderRecipients(
  transaction: SchedulerTransaction,
  appointment: Awaited<ReturnType<typeof dueAppointments>>[number],
) {
  return transaction
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
        eq(contactPatientLinks.clinicId, appointment.clinicId),
        eq(contactPatientLinks.patientId, appointment.patientId!),
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
}

async function enqueueDailyAgendas(
  transaction: SchedulerTransaction,
  now: Date,
) {
  if (now.getUTCHours() !== 8) return 0;
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
  let agendas = 0;
  for (const recipient of recipients) {
    const agenda = await transaction
      .select({ patientName: patients.name, startsAt: appointments.startsAt })
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
          lt(appointments.startsAt, new Date(now.valueOf() + 7 * 24 * HOUR_MS)),
        ),
      );
    const [inserted] = await transaction
      .insert(transactionalDeliveries)
      .values({
        clinicId: recipient.clinicId,
        idempotencyKey: `${recipient.doctorId}:${agendaDate}`,
        kind: "daily-agenda-pdf",
        nextAttemptAt: now,
        payload: {
          agenda,
          clinicName: recipient.clinicName,
          doctorName: recipient.doctorName ?? "Médico sin nombre público",
          recipientEmail: recipient.recipientEmail,
        },
        retainUntil: new Date(now.valueOf() + RETAIN_MS),
      })
      .onConflictDoNothing()
      .returning({ id: transactionalDeliveries.id });
    if (inserted !== undefined) agendas += 1;
  }
  return agendas;
}

async function activeOwner(
  transaction: SchedulerTransaction,
  clinicId: string,
) {
  return transaction.query.clinicUsers.findFirst({
    columns: { id: true },
    where: and(
      eq(clinicUsers.clinicId, clinicId),
      eq(clinicUsers.role, "owner"),
      eq(clinicUsers.active, true),
    ),
  });
}

function isCheckpointDue(
  startsAt: Date,
  checkpoint: AppointmentReminderCheckpoint,
  now: Date,
) {
  const scheduledAt = new Date(
    startsAt.valueOf() - Number.parseInt(checkpoint, 10) * HOUR_MS,
  );
  return (
    scheduledAt <= now &&
    now.valueOf() - scheduledAt.valueOf() <= REMINDER_CATCH_UP_MS
  );
}

function toDelivery(
  row: typeof transactionalDeliveries.$inferSelect,
): TransactionalDelivery {
  const payload = row.payload;
  if (row.kind === "appointment-reminder") {
    const reminder = payload as {
      appointmentId: string;
      appointmentStartsAt: string;
      checkpoint: AppointmentReminderCheckpoint;
      clinicName: string;
      recipient: { id: string; name: string; phoneE164: string };
    };
    return {
      attempts: row.attempts,
      clinicId: row.clinicId,
      id: row.id,
      idempotencyKey: row.idempotencyKey,
      kind: row.kind,
      payload: {
        ...reminder,
        appointmentStartsAt: new Date(reminder.appointmentStartsAt),
      },
    };
  }
  const agenda = payload as {
    agenda: Array<{ patientName: string; startsAt: string }>;
    clinicName: string;
    doctorName: string;
    recipientEmail: string;
  };
  return {
    attempts: row.attempts,
    clinicId: row.clinicId,
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    kind: row.kind,
    payload: {
      ...agenda,
      agenda: agenda.agenda.map((item) => ({
        ...item,
        startsAt: new Date(item.startsAt),
      })),
    },
  };
}
