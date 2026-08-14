import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { processSimulatedWhatsAppMessage } from "./simulated-whatsapp-booking";
import { listPendingGuardianshipVerifications } from "./administrative-records";
import { sendAppointmentReminder } from "./appointment-reminders";
import { canContactManageAppointment } from "./appointment-self-management";
import { resolveAppointmentSelfManagementEscalation } from "./appointment-self-management";
import {
  listConversationEscalations,
  resolveConversationEscalation,
} from "./conversation-escalations";
import { db } from "../db";
import {
  inClinicTransaction,
  inSuperadminTransaction,
} from "../db/clinic-context";
import {
  drizzleAppointmentSelfManagementStore,
  drizzleAppointmentSelfManagementEscalationResolver,
  drizzleConversationEscalationReader,
  drizzleConversationEscalationResolver,
  drizzleSimulatedWhatsAppBookingStore,
} from "../db/simulated-whatsapp-booking-store";
import { drizzleAdministrativeRecordsStore } from "../db/administrative-records-store";
import { drizzleManualAppointmentStore } from "../db/manual-appointment-store";
import {
  getSentSimulatedAppointmentReminders,
  simulatedAppointmentReminderSender,
} from "../whatsapp/simulated-appointment-messages";
import {
  appointments,
  appointmentSelfManagementEscalations,
  apoloSuperadmins,
  clinicUsers,
  clinics,
  conversationEscalations,
  conversationEvents,
  contactPatientLinks,
  contacts,
  doctors,
  effectiveSchedulePeriods,
  effectiveSchedules,
  patients,
  serviceOffers,
  services,
  simulatedWhatsAppMessages,
  user as identities,
} from "../db/schema";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("Reserva simulada de WhatsApp persistente", () => {
  databaseTest(
    "resuelve Clínica y Contacto por E.164, confirma una Reserva y aísla sus datos por RLS",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-08-12T14:00:00.000Z");
      try {
        await processSimulatedWhatsAppMessage(
          message(fixture, "message-1", "paciente patient-placeholder"),
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        const selected = await processSimulatedWhatsAppMessage(
          message(fixture, "message-2", `paciente ${fixture.patientId}`),
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        expect(selected).toMatchObject({ kind: "patient-selected" });
        await processSimulatedWhatsAppMessage(
          message(
            fixture,
            "message-3",
            `opciones ${fixture.offerId} 2026-08-17`,
          ),
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        const held = await processSimulatedWhatsAppMessage(
          message(fixture, "message-4", "reservar 2026-08-17T14:00:00.000Z"),
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        expect(held).toMatchObject({ kind: "reservation-held" });
        const confirmed = await processSimulatedWhatsAppMessage(
          message(fixture, "message-5", "confirmar"),
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        if (confirmed?.kind !== "appointment-confirmed") {
          throw new Error("No se confirmó la Cita de reserva");
        }
        const tutor = await inClinicTransaction(
          fixture,
          async (transaction) => {
            const [createdTutor] = await transaction
              .insert(contacts)
              .values({
                clinicId: fixture.clinicId,
                name: "Carlos Tutor",
                phoneE164: "+50370000003",
              })
              .returning({ id: contacts.id });
            if (createdTutor === undefined)
              throw new Error("No se creó el Tutor");
            await transaction.insert(contactPatientLinks).values({
              clinicId: fixture.clinicId,
              contactId: createdTutor.id,
              guardianDui: "01234567-8",
              guardianshipVerificationStatus: "pending",
              patientId: fixture.patientId,
              relationship: "tutor",
            });
            return createdTutor;
          },
        );
        const reminder = await sendAppointmentReminder(
          {
            appointmentId: confirmed.id,
            checkpoint: "24h",
            clinicId: fixture.clinicId,
            identityId: fixture.identityId,
            now: new Date("2026-08-16T14:00:00.000Z"),
          },
          drizzleManualAppointmentStore,
          simulatedAppointmentReminderSender,
        );
        expect(reminder.recipients.map((recipient) => recipient.id)).toEqual(
          expect.arrayContaining([fixture.contactId, tutor.id]),
        );
        expect(
          getSentSimulatedAppointmentReminders().some(
            (reminder) =>
              reminder.appointmentId === confirmed.id &&
              reminder.recipient.id === tutor.id,
          ),
        ).toBe(true);
        await processSimulatedWhatsAppMessage(
          message(fixture, "message-reply", "info"),
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        await expect(
          sendAppointmentReminder(
            {
              appointmentId: confirmed.id,
              checkpoint: "22h",
              clinicId: fixture.clinicId,
              identityId: fixture.identityId,
              now: new Date("2026-08-16T16:00:00.000Z"),
            },
            drizzleManualAppointmentStore,
            simulatedAppointmentReminderSender,
          ),
        ).resolves.toEqual({ recipients: [] });
        await inClinicTransaction(fixture, async (transaction) => {
          await expect(
            transaction
              .select({ authorContactId: appointments.authorContactId })
              .from(appointments)
              .where(eq(appointments.id, confirmed.id)),
          ).resolves.toEqual([{ authorContactId: fixture.contactId }]);
        });
        await expect(
          canContactManageAppointment(
            {
              appointmentId: confirmed.id,
              clinicId: fixture.clinicId,
              contactId: tutor.id,
            },
            drizzleAppointmentSelfManagementStore,
          ),
        ).resolves.toBe(false);
        await processSimulatedWhatsAppMessage(
          {
            from: "+50370000003",
            id: `${fixture.clinicId}-tutor-selects-patient`,
            text: `paciente ${fixture.patientId}`,
            to: fixture.whatsappNumber,
          },
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        const escalated = await processSimulatedWhatsAppMessage(
          {
            from: "+50370000003",
            id: `${fixture.clinicId}-tutor-cancels-appointment`,
            text: `cancelar ${confirmed.id}`,
            to: fixture.whatsappNumber,
          },
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        expect(escalated).toEqual({ kind: "conversation-silenced", text: "" });
        const escalation = await inClinicTransaction(fixture, (transaction) =>
          transaction
            .select({ id: appointmentSelfManagementEscalations.id })
            .from(appointmentSelfManagementEscalations)
            .where(
              eq(
                appointmentSelfManagementEscalations.appointmentId,
                confirmed.id,
              ),
            )
            .then((rows) => rows[0]),
        );
        if (escalation === undefined) {
          throw new Error("No se escaló la solicitud del Tutor");
        }
        await inClinicTransaction(fixture, async (transaction) => {
          await expect(
            transaction
              .select({
                action: appointmentSelfManagementEscalations.action,
                contactId: appointmentSelfManagementEscalations.contactId,
              })
              .from(appointmentSelfManagementEscalations)
              .where(
                eq(
                  appointmentSelfManagementEscalations.appointmentId,
                  confirmed.id,
                ),
              ),
          ).resolves.toEqual([{ action: "cancel", contactId: tutor.id }]);
        });
        await expect(
          processSimulatedWhatsAppMessage(
            {
              from: "+50370000003",
              id: `${fixture.clinicId}-tutor-after-escalation`,
              text: "info",
              to: fixture.whatsappNumber,
            },
            drizzleSimulatedWhatsAppBookingStore,
            now,
          ),
        ).resolves.toEqual({ kind: "conversation-silenced", text: "" });
        await expect(
          resolveAppointmentSelfManagementEscalation(
            {
              clinicId: fixture.clinicId,
              escalationId: escalation.id,
              identityId: fixture.identityId,
            },
            drizzleAppointmentSelfManagementEscalationResolver,
          ),
        ).resolves.toBe(true);
        await expect(
          processSimulatedWhatsAppMessage(
            {
              from: "+50370000003",
              id: `${fixture.clinicId}-tutor-after-close`,
              text: "info",
              to: fixture.whatsappNumber,
            },
            drizzleSimulatedWhatsAppBookingStore,
            now,
          ),
        ).resolves.toMatchObject({ kind: "public-information" });
        await expect(
          processSimulatedWhatsAppMessage(
            message(fixture, "message-4", "reservar 2026-08-17T14:00:00.000Z"),
            drizzleSimulatedWhatsAppBookingStore,
            now,
          ),
        ).resolves.toEqual(held);

        await inClinicTransaction(fixture.other, async (transaction) => {
          await expect(
            transaction
              .select({ id: appointments.id })
              .from(appointments)
              .where(eq(appointments.clinicId, fixture.clinicId)),
          ).resolves.toEqual([]);
          await expect(
            transaction
              .select({ id: simulatedWhatsAppMessages.id })
              .from(simulatedWhatsAppMessages)
              .where(eq(simulatedWhatsAppMessages.clinicId, fixture.clinicId)),
          ).resolves.toEqual([]);
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "persiste Escalamientos humanos y urgencias aislados por RLS",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-08-14T12:00:00.000Z");
      try {
        await expect(
          processSimulatedWhatsAppMessage(
            message(fixture, "human-request", "Quiero hablar con una persona"),
            drizzleSimulatedWhatsAppBookingStore,
            now,
          ),
        ).resolves.toEqual({ kind: "conversation-silenced", text: "" });
        const escalations = await listConversationEscalations(
          fixture,
          drizzleConversationEscalationReader,
        );
        expect(escalations).toMatchObject([
          { contact: { id: fixture.contactId }, trigger: "human-request" },
        ]);
        await expect(
          listConversationEscalations(
            fixture.other,
            drizzleConversationEscalationReader,
          ),
        ).resolves.toEqual([]);
        const escalation = escalations[0];
        if (escalation === undefined) throw new Error("Falta el Escalamiento");
        await expect(
          resolveConversationEscalation(
            { ...fixture, escalationId: escalation.id },
            drizzleConversationEscalationResolver,
          ),
        ).resolves.toBe(true);
        await expect(
          processSimulatedWhatsAppMessage(
            message(fixture, "urgency", "Tengo una urgencia médica"),
            drizzleSimulatedWhatsAppBookingStore,
            now,
          ),
        ).resolves.toMatchObject({ kind: "urgent-protocol" });
        await inClinicTransaction(fixture, async (transaction) => {
          await expect(
            transaction
              .select({ type: conversationEvents.type })
              .from(conversationEvents),
          ).resolves.toEqual([{ type: "urgency-protocol" }]);
        });
        await inClinicTransaction(fixture.other, async (transaction) => {
          await expect(
            transaction
              .select({ id: conversationEscalations.id })
              .from(conversationEscalations)
              .where(eq(conversationEscalations.clinicId, fixture.clinicId)),
          ).resolves.toEqual([]);
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "registra la tutela pendiente, la expone a Panacea y oculta al menor de Contactos no vinculados",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-08-12T14:00:00.000Z");
      try {
        const registered = await processSimulatedWhatsAppMessage(
          message(
            fixture,
            "minor-1",
            "registrar menor|Lucía Pérez|01234567-8|2018-04-02",
          ),
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        if (registered.kind !== "patient-registered") {
          throw new Error("No se registró el menor");
        }
        const tasks = await listPendingGuardianshipVerifications(
          fixture,
          drizzleAdministrativeRecordsStore,
        );
        expect(tasks).toHaveLength(1);
        expect(tasks[0]?.guardianDui).toBe("01234567-8");
        expect(tasks[0]?.patient.id).toBe(registered.patientId);
        await expect(
          listPendingGuardianshipVerifications(
            fixture.other,
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toEqual([]);

        await inClinicTransaction(fixture, async (transaction) => {
          await transaction.insert(contacts).values({
            clinicId: fixture.clinicId,
            name: "Carlos",
            phoneE164: "+50370000003",
          });
        });
        const privateMessage = (id: string, patientId: string) =>
          processSimulatedWhatsAppMessage(
            {
              from: "+50370000003",
              id: `${fixture.clinicId}-${id}`,
              text: `paciente ${patientId}`,
              to: fixture.whatsappNumber,
            },
            drizzleSimulatedWhatsAppBookingStore,
            now,
          );
        await expect(
          privateMessage("minor-privacy", registered.patientId),
        ).resolves.toEqual(
          await privateMessage(
            "missing-privacy",
            "patient-that-does-not-exist",
          ),
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

function message(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  id: string,
  text: string,
) {
  return {
    from: fixture.contactPhone,
    id: `${fixture.clinicId}-${id}`,
    text,
    to: fixture.whatsappNumber,
  };
}

async function createFixture() {
  const suffix = randomUUID();
  const ownerIdentityId = `apo-18-owner-${suffix}`;
  const otherIdentityId = `apo-18-other-${suffix}`;
  const superadminIdentityId = `apo-18-superadmin-${suffix}`;
  const whatsappNumber = `+5037${Date.now().toString().slice(-7)}`;
  const contactPhone = "+50370000002";
  await db.insert(identities).values(
    [ownerIdentityId, otherIdentityId, superadminIdentityId].map((id) => ({
      createdAt: new Date(),
      email: `${id}@example.test`,
      emailVerified: true,
      id,
      name: id,
      updatedAt: new Date(),
    })),
  );
  await db
    .insert(apoloSuperadmins)
    .values({ identityId: superadminIdentityId });
  const createClinic = (identityId: string, name: string, number?: string) =>
    inSuperadminTransaction(superadminIdentityId, async (transaction) => {
      const [clinic] = await transaction
        .insert(clinics)
        .values({
          isSynthetic: true,
          name,
          whatsappNumberE164: number,
        })
        .returning({ id: clinics.id });
      if (clinic === undefined) throw new Error("No se creó la Clínica");
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${clinic.id}, true)`,
      );
      await transaction.insert(clinicUsers).values({
        clinicId: clinic.id,
        identityId,
        role: "owner",
      });
      return { clinicId: clinic.id, identityId };
    });
  const primary = await createClinic(
    ownerIdentityId,
    "Clínica APO-18",
    whatsappNumber,
  );
  const other = await createClinic(otherIdentityId, "Otra Clínica APO-18");
  const records = await inClinicTransaction(primary, async (transaction) => {
    const owner = await transaction.query.clinicUsers.findFirst({
      columns: { id: true },
      where: and(
        eq(clinicUsers.clinicId, primary.clinicId),
        eq(clinicUsers.identityId, ownerIdentityId),
      ),
    });
    if (owner === undefined) throw new Error("Falta el propietario");
    const [doctor] = await transaction
      .insert(doctors)
      .values({
        clinicId: primary.clinicId,
        clinicUserId: owner.id,
        publicName: "Dra. Sol",
        primarySpecialty: "Medicina familiar",
      })
      .returning({ id: doctors.id });
    const [service] = await transaction
      .insert(services)
      .values({
        clinicId: primary.clinicId,
        description: "Consulta administrativa",
        name: "Consulta",
        normalizedName: "consulta",
      })
      .returning({ id: services.id });
    if (doctor === undefined || service === undefined)
      throw new Error("Falta la configuración de Agenda");
    const [offer] = await transaction
      .insert(serviceOffers)
      .values({
        bufferMinutes: 0,
        clinicId: primary.clinicId,
        doctorId: doctor.id,
        durationMinutes: 30,
        priceUsd: "25.00",
        serviceId: service.id,
      })
      .returning({ id: serviceOffers.id });
    const [schedule] = await transaction
      .insert(effectiveSchedules)
      .values({
        clinicId: primary.clinicId,
        doctorId: doctor.id,
        effectiveFrom: "2026-08-01",
        timezone: "America/El_Salvador",
      })
      .returning({ id: effectiveSchedules.id });
    if (offer === undefined || schedule === undefined)
      throw new Error("Falta Oferta u Horario");
    await transaction.insert(effectiveSchedulePeriods).values({
      clinicId: primary.clinicId,
      dayOfWeek: 1,
      doctorId: doctor.id,
      endTime: "10:00",
      scheduleId: schedule.id,
      startTime: "08:00",
    });
    const [contact] = await transaction
      .insert(contacts)
      .values({
        clinicId: primary.clinicId,
        name: "Ana",
        phoneE164: contactPhone,
      })
      .returning({ id: contacts.id });
    const [patient] = await transaction
      .insert(patients)
      .values({
        birthDate: "1990-01-01",
        clinicId: primary.clinicId,
        name: "Ana",
      })
      .returning({ id: patients.id });
    if (contact === undefined || patient === undefined)
      throw new Error("Falta Contacto o Paciente");
    await transaction.insert(contactPatientLinks).values({
      clinicId: primary.clinicId,
      contactId: contact.id,
      patientId: patient.id,
    });
    return { contactId: contact.id, offerId: offer.id, patientId: patient.id };
  });
  return {
    ...primary,
    ...records,
    contactPhone,
    other,
    whatsappNumber,
    async cleanup() {
      await inClinicTransaction(primary, (transaction) =>
        transaction
          .delete(appointments)
          .where(eq(appointments.clinicId, primary.clinicId)),
      );
      await inSuperadminTransaction(
        superadminIdentityId,
        async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${primary.clinicId}, true)`,
          );
          await transaction
            .delete(clinics)
            .where(eq(clinics.id, primary.clinicId));
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${other.clinicId}, true)`,
          );
          await transaction
            .delete(clinics)
            .where(eq(clinics.id, other.clinicId));
        },
      );
      await db.delete(identities).where(eq(identities.id, ownerIdentityId));
      await db.delete(identities).where(eq(identities.id, otherIdentityId));
      await db
        .delete(identities)
        .where(eq(identities.id, superadminIdentityId));
    },
  };
}
