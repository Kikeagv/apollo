import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  cancelManualAppointment,
  createManualAppointment,
  listPanaceaCalendar,
  listCancelledManualAppointments,
  listManualAppointmentFormData,
  listManualAppointments,
  type ManualAppointmentTransactionalMessage,
  ManualAppointmentNotCancellableError,
  ManualAppointmentOutsideScheduleConfirmationRequiredError,
} from "./manual-appointments";
import { db } from "../db";
import {
  inClinicTransaction,
  inSuperadminTransaction,
} from "../db/clinic-context";
import { drizzleManualAppointmentStore } from "../db/manual-appointment-store";
import {
  appointmentEvents,
  appointments,
  apoloSuperadmins,
  availabilityBlocks,
  clinicUsers,
  clinics,
  contactPatientLinks,
  contacts,
  doctors,
  effectiveSchedulePeriods,
  effectiveSchedules,
  patients,
  serviceOffers,
  services,
  temporaryReservations,
  user as identities,
} from "../db/schema";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("Citas manuales persistentes", () => {
  databaseTest(
    "envía Mensajes transaccionales opcionales al Contacto vinculado elegido, registra sus resultados y conserva el aislamiento de Clínica",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-08-08T00:00:00.000Z");
      const sent: ManualAppointmentTransactionalMessage[] = [];
      const sender = {
        async send(message: ManualAppointmentTransactionalMessage) {
          sent.push(message);
        },
      };
      try {
        const appointment = await createManualAppointment(
          {
            clinicId: fixture.clinicId,
            doctorId: fixture.doctorId,
            identityId: fixture.secretaryIdentityId,
            notificationRecipientContactId: fixture.contactId,
            patientId: fixture.patientId,
            serviceOfferId: fixture.serviceOfferId,
            startsAt: new Date("2026-08-10T14:00:00.000Z"),
          },
          drizzleManualAppointmentStore,
          now,
          sender,
        );
        expect(sent).toHaveLength(1);
        expect(sent[0]?.recipient.id).toBe(fixture.contactId);
        expect(sent[0]?.type).toBe("manual-confirmation");

        await cancelManualAppointment(
          {
            appointmentId: appointment.id,
            clinicId: fixture.clinicId,
            identityId: fixture.secretaryIdentityId,
            notificationRecipientContactId: fixture.contactId,
          },
          drizzleManualAppointmentStore,
          now,
          sender,
        );
        const cancelled = await listCancelledManualAppointments(
          {
            clinicId: fixture.clinicId,
            identityId: fixture.secretaryIdentityId,
          },
          drizzleManualAppointmentStore,
        );
        expect(cancelled).toMatchObject([
          {
            events: [
              { type: "manual-created" },
              {
                recipient: { id: fixture.contactId },
                type: "manual-confirmation-sent",
              },
              { type: "cancelled" },
              {
                recipient: { id: fixture.contactId },
                type: "manual-cancellation-sent",
              },
            ],
            id: appointment.id,
          },
        ]);

        const failedDelivery = await createManualAppointment(
          {
            clinicId: fixture.clinicId,
            doctorId: fixture.doctorId,
            identityId: fixture.secretaryIdentityId,
            notificationRecipientContactId: fixture.contactId,
            patientId: fixture.patientId,
            serviceOfferId: fixture.serviceOfferId,
            startsAt: new Date("2026-08-10T14:40:00.000Z"),
          },
          drizzleManualAppointmentStore,
          now,
          {
            async send() {
              throw new Error("Proveedor no disponible");
            },
          },
        );
        await expect(
          listManualAppointments(
            {
              clinicId: fixture.clinicId,
              identityId: fixture.secretaryIdentityId,
            },
            drizzleManualAppointmentStore,
          ),
        ).resolves.toMatchObject([
          {
            events: [
              { type: "manual-created" },
              {
                recipient: { id: fixture.contactId },
                type: "manual-confirmation-failed",
              },
            ],
            id: failedDelivery.id,
          },
        ]);
        await inClinicTransaction(
          {
            clinicId: fixture.otherClinicId,
            identityId: fixture.otherOwnerIdentityId,
          },
          async (transaction) => {
            await expect(
              transaction
                .select({ id: appointmentEvents.id })
                .from(appointmentEvents)
                .where(eq(appointmentEvents.appointmentId, appointment.id)),
            ).resolves.toEqual([]);
          },
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "cancela Citas manuales para todos los roles, conserva el historial y libera la capacidad sin cruzar Clínicas",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-08-08T00:00:00.000Z");
      try {
        const identities = [
          fixture.ownerIdentityId,
          fixture.doctorIdentityId,
          fixture.secretaryIdentityId,
        ];
        const appointmentsToCancel = await Promise.all(
          identities.map((identityId, index) =>
            createManualAppointment(
              {
                clinicId: fixture.clinicId,
                doctorId: fixture.doctorId,
                identityId,
                patientId: fixture.patientId,
                serviceOfferId: fixture.serviceOfferId,
                startsAt: new Date(
                  `2026-08-10T${["14:00", "14:40", "15:20"][index] ?? "14:00"}:00.000Z`,
                ),
              },
              drizzleManualAppointmentStore,
              now,
            ),
          ),
        );

        await Promise.all(
          appointmentsToCancel.map((appointment, index) =>
            cancelManualAppointment(
              {
                appointmentId: appointment.id,
                clinicId: fixture.clinicId,
                identityId: identities[index] ?? fixture.ownerIdentityId,
                reason: index === 0 ? "Paciente no podrá asistir" : undefined,
              },
              drizzleManualAppointmentStore,
              now,
            ),
          ),
        );

        await expect(
          listManualAppointments(
            {
              clinicId: fixture.clinicId,
              identityId: fixture.secretaryIdentityId,
            },
            drizzleManualAppointmentStore,
          ),
        ).resolves.toEqual([]);
        const cancelled = await listCancelledManualAppointments(
          {
            clinicId: fixture.clinicId,
            identityId: fixture.secretaryIdentityId,
          },
          drizzleManualAppointmentStore,
        );
        const firstCancelled = cancelled.find(
          (appointment) => appointment.id === appointmentsToCancel[0]?.id,
        );
        if (firstCancelled === undefined)
          throw new Error("No se listó la Cita cancelada");
        expect(firstCancelled.status).toBe("cancelled");
        expect(firstCancelled.patient.id).toBe(fixture.patientId);
        expect(firstCancelled.events.map((event) => event.type)).toEqual([
          "manual-created",
          "cancelled",
        ]);
        expect(
          firstCancelled.events.find((event) => event.type === "cancelled"),
        ).toMatchObject({
          actorClinicUserId: fixture.ownerClinicUserId,
          reason: "Paciente no podrá asistir",
        });
        const replacement = await createManualAppointment(
          {
            clinicId: fixture.clinicId,
            doctorId: fixture.doctorId,
            identityId: fixture.secretaryIdentityId,
            patientId: fixture.patientId,
            serviceOfferId: fixture.serviceOfferId,
            startsAt: new Date("2026-08-10T14:00:00.000Z"),
          },
          drizzleManualAppointmentStore,
          now,
        );
        expect(replacement.startsAt).toEqual(
          new Date("2026-08-10T14:00:00.000Z"),
        );
        await expect(
          cancelManualAppointment(
            {
              appointmentId: replacement.id,
              clinicId: fixture.otherClinicId,
              identityId: fixture.otherOwnerIdentityId,
            },
            drizzleManualAppointmentStore,
            now,
          ),
        ).rejects.toBeInstanceOf(ManualAppointmentNotCancellableError);
        await expect(
          listManualAppointments(
            {
              clinicId: fixture.clinicId,
              identityId: fixture.secretaryIdentityId,
            },
            drizzleManualAppointmentStore,
          ),
        ).resolves.toMatchObject([{ id: replacement.id }]);

        await inClinicTransaction(
          {
            clinicId: fixture.otherClinicId,
            identityId: fixture.otherOwnerIdentityId,
          },
          async (transaction) => {
            await expect(
              transaction
                .select({ id: appointments.id })
                .from(appointments)
                .where(eq(appointments.id, appointmentsToCancel[0]?.id ?? "")),
            ).resolves.toEqual([]);
            await expect(
              transaction
                .select({ id: appointmentEvents.id })
                .from(appointmentEvents)
                .where(
                  eq(
                    appointmentEvents.appointmentId,
                    appointmentsToCancel[0]?.id ?? "",
                  ),
                ),
            ).resolves.toEqual([]);
          },
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "consulta datos del formulario de Agenda para cada rol clínico sin filtrar otra Clínica",
    async () => {
      const fixture = await createFixture();
      try {
        const inputs = [
          fixture.ownerIdentityId,
          fixture.doctorIdentityId,
          fixture.secretaryIdentityId,
        ].map((identityId) => ({
          clinicId: fixture.clinicId,
          identityId,
        }));
        const expected = {
          offers: [
            {
              doctorId: fixture.doctorId,
              doctorName: "Dra. Sol",
              serviceName: "Consulta",
              serviceOfferId: fixture.serviceOfferId,
            },
          ],
          patients: [
            {
              contacts: [
                {
                  id: fixture.contactId,
                  name: "Ana Martínez",
                  phoneE164: "+50371234567",
                },
              ],
              id: fixture.patientId,
              name: "Lucía Martínez",
            },
          ],
        };

        await expect(
          Promise.all(
            inputs.map((input) =>
              listManualAppointmentFormData(
                input,
                drizzleManualAppointmentStore,
              ),
            ),
          ),
        ).resolves.toEqual([expected, expected, expected]);
        await expect(
          listManualAppointmentFormData(
            {
              clinicId: fixture.otherClinicId,
              identityId: fixture.otherOwnerIdentityId,
            },
            drizzleManualAppointmentStore,
          ),
        ).resolves.toEqual({ offers: [], patients: [] });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "consulta Citas activas y canceladas para cada rol clínico sin filtrar otra Clínica",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-08-08T00:00:00.000Z");
      const clinicInputs = [
        fixture.ownerIdentityId,
        fixture.doctorIdentityId,
        fixture.secretaryIdentityId,
      ].map((identityId) => ({
        clinicId: fixture.clinicId,
        identityId,
      }));
      const otherClinicInput = {
        clinicId: fixture.otherClinicId,
        identityId: fixture.otherOwnerIdentityId,
      };
      try {
        const appointment = await createManualAppointment(
          {
            clinicId: fixture.clinicId,
            doctorId: fixture.doctorId,
            identityId: fixture.ownerIdentityId,
            patientId: fixture.patientId,
            serviceOfferId: fixture.serviceOfferId,
            startsAt: new Date("2026-08-10T14:00:00.000Z"),
          },
          drizzleManualAppointmentStore,
          now,
        );

        await expect(
          Promise.all(
            clinicInputs.map((input) =>
              listManualAppointments(input, drizzleManualAppointmentStore),
            ),
          ),
        ).resolves.toEqual([
          [expect.objectContaining({ id: appointment.id })],
          [expect.objectContaining({ id: appointment.id })],
          [expect.objectContaining({ id: appointment.id })],
        ]);
        await expect(
          listManualAppointments(
            otherClinicInput,
            drizzleManualAppointmentStore,
          ),
        ).resolves.toEqual([]);

        await cancelManualAppointment(
          {
            appointmentId: appointment.id,
            clinicId: fixture.clinicId,
            identityId: fixture.secretaryIdentityId,
          },
          drizzleManualAppointmentStore,
          now,
        );

        await expect(
          Promise.all(
            clinicInputs.map((input) =>
              listCancelledManualAppointments(
                input,
                drizzleManualAppointmentStore,
              ),
            ),
          ),
        ).resolves.toEqual([
          [expect.objectContaining({ id: appointment.id })],
          [expect.objectContaining({ id: appointment.id })],
          [expect.objectContaining({ id: appointment.id })],
        ]);
        await expect(
          listCancelledManualAppointments(
            otherClinicInput,
            drizzleManualAppointmentStore,
          ),
        ).resolves.toEqual([]);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest("no cancela una Cita manual que ya inició", async () => {
    const fixture = await createFixture();
    try {
      const appointment = await createManualAppointment(
        {
          clinicId: fixture.clinicId,
          doctorId: fixture.doctorId,
          identityId: fixture.ownerIdentityId,
          patientId: fixture.patientId,
          serviceOfferId: fixture.serviceOfferId,
          startsAt: new Date("2026-08-10T14:00:00.000Z"),
        },
        drizzleManualAppointmentStore,
        new Date("2026-08-08T00:00:00.000Z"),
      );

      await expect(
        cancelManualAppointment(
          {
            appointmentId: appointment.id,
            clinicId: fixture.clinicId,
            identityId: fixture.secretaryIdentityId,
          },
          drizzleManualAppointmentStore,
          new Date("2026-08-10T14:00:00.000Z"),
        ),
      ).rejects.toBeInstanceOf(ManualAppointmentNotCancellableError);
    } finally {
      await fixture.cleanup();
    }
  });

  databaseTest(
    "requiere confirmación cuando la duración y el buffer rebasan el Horario vigente",
    async () => {
      const fixture = await createFixture();
      const input = {
        clinicId: fixture.clinicId,
        doctorId: fixture.doctorId,
        identityId: fixture.doctorIdentityId,
        patientId: fixture.patientId,
        serviceOfferId: fixture.serviceOfferId,
        startsAt: new Date("2026-08-10T15:30:00.000Z"),
      };
      try {
        await expect(
          createManualAppointment(
            input,
            drizzleManualAppointmentStore,
            new Date("2026-08-08T00:00:00.000Z"),
          ),
        ).rejects.toBeInstanceOf(
          ManualAppointmentOutsideScheduleConfirmationRequiredError,
        );
        const created = await createManualAppointment(
          { ...input, outsideScheduleConfirmed: true },
          drizzleManualAppointmentStore,
          new Date("2026-08-08T00:00:00.000Z"),
        );
        await expect(
          listManualAppointments(
            {
              clinicId: fixture.clinicId,
              identityId: fixture.doctorIdentityId,
            },
            drizzleManualAppointmentStore,
          ),
        ).resolves.toMatchObject([{ id: created.id, outsideSchedule: true }]);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "advierte y conserva la marca de una Cita manual fuera de horario sin abrir capacidad ocupada ni otra Clínica",
    async () => {
      const fixture = await createFixture();
      const input = {
        clinicId: fixture.clinicId,
        doctorId: fixture.doctorId,
        identityId: fixture.secretaryIdentityId,
        patientId: fixture.patientId,
        serviceOfferId: fixture.serviceOfferId,
        startsAt: new Date("2026-08-10T16:00:00.000Z"),
      };
      try {
        await expect(
          createManualAppointment(
            input,
            drizzleManualAppointmentStore,
            new Date("2026-08-08T00:00:00.000Z"),
          ),
        ).rejects.toBeInstanceOf(
          ManualAppointmentOutsideScheduleConfirmationRequiredError,
        );

        const created = await createManualAppointment(
          { ...input, outsideScheduleConfirmed: true },
          drizzleManualAppointmentStore,
          new Date("2026-08-08T00:00:00.000Z"),
        );
        await expect(
          createManualAppointment(
            {
              ...input,
              outsideScheduleConfirmed: true,
              startsAt: new Date("2026-08-10T16:05:00.000Z"),
            },
            drizzleManualAppointmentStore,
            new Date("2026-08-08T00:00:00.000Z"),
          ),
        ).rejects.toThrow(
          "La Cita manual ya no es una Opción de atención autorizada",
        );
        await expect(
          listManualAppointments(
            {
              clinicId: fixture.clinicId,
              identityId: fixture.secretaryIdentityId,
            },
            drizzleManualAppointmentStore,
          ),
        ).resolves.toMatchObject([{ id: created.id, outsideSchedule: true }]);
        await inClinicTransaction(
          {
            clinicId: fixture.otherClinicId,
            identityId: fixture.otherOwnerIdentityId,
          },
          async (transaction) => {
            await expect(
              transaction
                .select({ outsideSchedule: appointments.outsideSchedule })
                .from(appointments)
                .where(eq(appointments.id, created.id)),
            ).resolves.toEqual([]);
          },
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "crea una Cita elegible con snapshots, evento y detalle operativo para una Secretaria",
    async () => {
      const fixture = await createFixture();
      try {
        const created = await createManualAppointment(
          {
            clinicId: fixture.clinicId,
            doctorId: fixture.doctorId,
            identityId: fixture.secretaryIdentityId,
            patientId: fixture.patientId,
            serviceOfferId: fixture.serviceOfferId,
            startsAt: new Date("2026-08-10T14:00:00.000Z"),
          },
          drizzleManualAppointmentStore,
          new Date("2026-08-08T00:00:00.000Z"),
        );

        expect(created).toMatchObject({
          bufferMinutes: 5,
          durationMinutes: 30,
          origin: "manual",
          patientId: fixture.patientId,
          priceUsd: "35.00",
          startsAt: new Date("2026-08-10T14:00:00.000Z"),
        });
        const listed = await listManualAppointments(
          {
            clinicId: fixture.clinicId,
            identityId: fixture.secretaryIdentityId,
          },
          drizzleManualAppointmentStore,
        );
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({
          contacts: [{ name: "Ana Martínez", phoneE164: "+50371234567" }],
          doctor: { name: "Dra. Sol" },
          events: [
            {
              actorClinicUserId: fixture.secretaryClinicUserId,
              type: "manual-created",
            },
          ],
          id: created.id,
          patient: { name: "Lucía Martínez" },
          service: { name: "Consulta" },
        });

        await inClinicTransaction(
          {
            clinicId: fixture.otherClinicId,
            identityId: fixture.otherOwnerIdentityId,
          },
          async (transaction) => {
            await expect(
              transaction
                .select({ id: appointments.id })
                .from(appointments)
                .where(eq(appointments.id, created.id)),
            ).resolves.toEqual([]);
            await expect(
              transaction
                .select({ id: appointmentEvents.id })
                .from(appointmentEvents)
                .where(eq(appointmentEvents.appointmentId, created.id)),
            ).resolves.toEqual([]);
          },
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "autoriza al propietario, Médico y Secretaria a confirmar Citas fuera de horario, sin permitir a la Secretaria configurar Ofertas",
    async () => {
      const fixture = await createFixture();
      try {
        const startsAt = ["16:00", "16:40", "17:20"];
        const identities = [
          fixture.ownerIdentityId,
          fixture.doctorIdentityId,
          fixture.secretaryIdentityId,
        ];
        const created = await Promise.all(
          identities.map((identityId, index) =>
            createManualAppointment(
              {
                clinicId: fixture.clinicId,
                doctorId: fixture.doctorId,
                identityId,
                patientId: fixture.patientId,
                serviceOfferId: fixture.serviceOfferId,
                outsideScheduleConfirmed: true,
                startsAt: new Date(
                  `2026-08-10T${startsAt[index] ?? "14:00"}:00.000Z`,
                ),
              },
              drizzleManualAppointmentStore,
              new Date("2026-08-08T00:00:00.000Z"),
            ),
          ),
        );
        expect(created.map((appointment) => appointment.id)).toHaveLength(3);

        await inClinicTransaction(
          {
            clinicId: fixture.clinicId,
            identityId: fixture.secretaryIdentityId,
          },
          async (transaction) => {
            await expect(
              transaction
                .update(serviceOffers)
                .set({ priceUsd: "99.00" })
                .where(eq(serviceOffers.id, fixture.serviceOfferId))
                .returning({ id: serviceOffers.id }),
            ).resolves.toEqual([]);
          },
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "rechaza un traslape concurrente sin mover la Cita manual solicitada",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-08-08T00:00:00.000Z");
      try {
        await createManualAppointment(
          {
            clinicId: fixture.clinicId,
            doctorId: fixture.doctorId,
            identityId: fixture.ownerIdentityId,
            patientId: fixture.patientId,
            serviceOfferId: fixture.serviceOfferId,
            startsAt: new Date("2026-08-10T14:00:00.000Z"),
          },
          drizzleManualAppointmentStore,
          now,
        );
        await expect(
          createManualAppointment(
            {
              clinicId: fixture.clinicId,
              doctorId: fixture.doctorId,
              identityId: fixture.secretaryIdentityId,
              patientId: fixture.patientId,
              serviceOfferId: fixture.serviceOfferId,
              startsAt: new Date("2026-08-10T14:05:00.000Z"),
            },
            drizzleManualAppointmentStore,
            now,
          ),
        ).rejects.toThrow(
          "La Cita manual ya no es una Opción de atención autorizada",
        );
        await expect(
          listManualAppointments(
            {
              clinicId: fixture.clinicId,
              identityId: fixture.secretaryIdentityId,
            },
            drizzleManualAppointmentStore,
          ),
        ).resolves.toMatchObject([
          { startsAt: new Date("2026-08-10T14:00:00.000Z") },
        ]);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "muestra en el Calendario una Cita activa creada desde una Reserva temporal",
    async () => {
      const fixture = await createFixture();
      try {
        await inClinicTransaction(
          {
            clinicId: fixture.clinicId,
            identityId: fixture.ownerIdentityId,
          },
          (transaction) =>
            transaction.insert(appointments).values({
              actorClinicUserId: fixture.ownerClinicUserId,
              bufferMinutes: 5,
              clinicId: fixture.clinicId,
              doctorId: fixture.doctorId,
              durationMinutes: 30,
              endsAt: new Date("2026-08-10T15:30:00.000Z"),
              occupiedUntil: new Date("2026-08-10T15:35:00.000Z"),
              origin: "reservation",
              patientId: fixture.patientId,
              priceUsd: "35.00",
              serviceOfferId: fixture.serviceOfferId,
              startsAt: new Date("2026-08-10T15:00:00.000Z"),
            }),
        );
        await expect(
          listManualAppointments(
            {
              clinicId: fixture.clinicId,
              identityId: fixture.secretaryIdentityId,
            },
            drizzleManualAppointmentStore,
          ),
        ).resolves.toMatchObject([
          {
            origin: "reservation",
            patient: { name: "Lucía Martínez" },
            service: { name: "Consulta" },
          },
        ]);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "el seam de Agenda consulta Citas y Bloqueos, filtra por Médico y no permite leer ni mutar otra Clínica",
    async () => {
      const fixture = await createFixture();
      try {
        const appointment = await createManualAppointment(
          {
            clinicId: fixture.clinicId,
            doctorId: fixture.doctorId,
            identityId: fixture.ownerIdentityId,
            patientId: fixture.patientId,
            serviceOfferId: fixture.serviceOfferId,
            startsAt: new Date("2026-08-10T14:00:00.000Z"),
          },
          drizzleManualAppointmentStore,
          new Date("2026-08-08T00:00:00.000Z"),
        );
        const [block] = await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.ownerIdentityId },
          (transaction) =>
            transaction
              .insert(availabilityBlocks)
              .values({
                clinicId: fixture.clinicId,
                doctorId: fixture.doctorId,
                endsAt: new Date("2026-08-10T15:45:00.000Z"),
                privateLabel: "Capacitación interna",
                startsAt: new Date("2026-08-10T14:45:00.000Z"),
              })
              .returning({ id: availabilityBlocks.id }),
        );
        if (block === undefined) throw new Error("No se creó el Bloqueo");

        await expect(
          listPanaceaCalendar(
            {
              clinicId: fixture.clinicId,
              doctorId: fixture.doctorId,
              from: new Date("2026-08-10T13:45:00.000Z"),
              identityId: fixture.secretaryIdentityId,
              to: new Date("2026-08-10T16:00:00.000Z"),
            },
            drizzleManualAppointmentStore,
          ),
        ).resolves.toEqual([
          expect.objectContaining({ id: appointment.id }),
          expect.objectContaining({
            id: block.id,
            privateLabel: "Capacitación interna",
          }),
        ]);
        await expect(
          listPanaceaCalendar(
            {
              clinicId: fixture.clinicId,
              doctorId: "00000000-0000-0000-0000-000000000000",
              from: new Date("2026-08-10T13:45:00.000Z"),
              identityId: fixture.secretaryIdentityId,
              to: new Date("2026-08-10T16:00:00.000Z"),
            },
            drizzleManualAppointmentStore,
          ),
        ).resolves.toEqual([]);
        await expect(
          listPanaceaCalendar(
            {
              clinicId: fixture.clinicId,
              doctorId: fixture.doctorId,
              from: new Date("2026-08-10T14:30:00.000Z"),
              identityId: fixture.secretaryIdentityId,
              to: new Date("2026-08-10T16:00:00.000Z"),
            },
            drizzleManualAppointmentStore,
          ),
        ).resolves.toEqual([
          expect.objectContaining({
            id: block.id,
            privateLabel: "Capacitación interna",
          }),
        ]);
        await expect(
          listPanaceaCalendar(
            {
              clinicId: fixture.otherClinicId,
              from: new Date("2026-08-10T13:45:00.000Z"),
              identityId: fixture.otherOwnerIdentityId,
              to: new Date("2026-08-10T16:00:00.000Z"),
            },
            drizzleManualAppointmentStore,
          ),
        ).resolves.toEqual([]);
        await expect(
          cancelManualAppointment(
            {
              appointmentId: appointment.id,
              clinicId: fixture.otherClinicId,
              identityId: fixture.otherOwnerIdentityId,
            },
            drizzleManualAppointmentStore,
          ),
        ).rejects.toBeInstanceOf(ManualAppointmentNotCancellableError);
        await expect(
          listManualAppointments(
            {
              clinicId: fixture.clinicId,
              identityId: fixture.secretaryIdentityId,
            },
            drizzleManualAppointmentStore,
          ),
        ).resolves.toMatchObject([{ id: appointment.id, status: "confirmed" }]);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "rechaza Bloqueos y Reservas temporales activas sin crear una Cita",
    async () => {
      const fixture = await createFixture();
      const input = {
        clinicId: fixture.clinicId,
        doctorId: fixture.doctorId,
        identityId: fixture.secretaryIdentityId,
        patientId: fixture.patientId,
        serviceOfferId: fixture.serviceOfferId,
        startsAt: new Date("2026-08-10T16:00:00.000Z"),
        outsideScheduleConfirmed: true,
      };
      try {
        await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.ownerIdentityId },
          (transaction) =>
            transaction.insert(availabilityBlocks).values({
              clinicId: fixture.clinicId,
              doctorId: fixture.doctorId,
              endsAt: new Date("2026-08-10T16:30:00.000Z"),
              startsAt: new Date("2026-08-10T16:00:00.000Z"),
            }),
        );
        await expect(
          createManualAppointment(
            input,
            drizzleManualAppointmentStore,
            new Date("2026-08-08T00:00:00.000Z"),
          ),
        ).rejects.toThrow(
          "La Cita manual ya no es una Opción de atención autorizada",
        );
        await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.ownerIdentityId },
          (transaction) =>
            transaction
              .delete(availabilityBlocks)
              .where(eq(availabilityBlocks.clinicId, fixture.clinicId)),
        );
        await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.ownerIdentityId },
          (transaction) =>
            transaction.insert(temporaryReservations).values({
              clinicId: fixture.clinicId,
              doctorId: fixture.doctorId,
              endsAt: new Date("2026-08-10T16:30:00.000Z"),
              expiresAt: new Date(Date.now() + 10 * 60_000),
              startsAt: new Date("2026-08-10T16:00:00.000Z"),
            }),
        );
        await expect(
          createManualAppointment(
            input,
            drizzleManualAppointmentStore,
            new Date("2026-08-08T00:00:00.000Z"),
          ),
        ).rejects.toThrow(
          "La Cita manual ya no es una Opción de atención autorizada",
        );
        await expect(
          listManualAppointments(
            {
              clinicId: fixture.clinicId,
              identityId: fixture.secretaryIdentityId,
            },
            drizzleManualAppointmentStore,
          ),
        ).resolves.toEqual([]);
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

async function createFixture() {
  const suffix = randomUUID();
  const ids = {
    doctor: `apo-39-doctor-${suffix}`,
    otherOwner: `apo-39-other-owner-${suffix}`,
    owner: `apo-39-owner-${suffix}`,
    secretary: `apo-39-secretary-${suffix}`,
    superadmin: `apo-39-superadmin-${suffix}`,
  };
  await db.insert(identities).values(
    Object.entries(ids).map(([name, id]) => ({
      createdAt: new Date(),
      email: `${id}@example.test`,
      emailVerified: true,
      id,
      name,
      updatedAt: new Date(),
    })),
  );
  await db.insert(apoloSuperadmins).values({ identityId: ids.superadmin });

  const primary = await inSuperadminTransaction(
    ids.superadmin,
    async (transaction) => {
      const [clinic] = await transaction
        .insert(clinics)
        .values({ isSynthetic: true, name: "Clínica APO-39" })
        .returning({ id: clinics.id });
      if (clinic === undefined) throw new Error("No se creó la Clínica");
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${clinic.id}, true)`,
      );
      const members = await transaction
        .insert(clinicUsers)
        .values([
          { clinicId: clinic.id, identityId: ids.owner, role: "owner" },
          { clinicId: clinic.id, identityId: ids.doctor, role: "doctor" },
          {
            clinicId: clinic.id,
            identityId: ids.secretary,
            role: "secretary",
          },
        ])
        .returning({ id: clinicUsers.id, identityId: clinicUsers.identityId });
      const doctorMember = members.find(
        (member) => member.identityId === ids.doctor,
      );
      const secretaryMember = members.find(
        (member) => member.identityId === ids.secretary,
      );
      const ownerMember = members.find(
        (member) => member.identityId === ids.owner,
      );
      if (
        doctorMember === undefined ||
        ownerMember === undefined ||
        secretaryMember === undefined
      ) {
        throw new Error("No se crearon los Usuarios de clínica");
      }
      const [doctor] = await transaction
        .insert(doctors)
        .values({
          clinicId: clinic.id,
          clinicUserId: doctorMember.id,
          primarySpecialty: "Medicina familiar",
          publicName: "Dra. Sol",
        })
        .returning({ id: doctors.id });
      const [service] = await transaction
        .insert(services)
        .values({
          clinicId: clinic.id,
          description: "Consulta general",
          name: "Consulta",
          normalizedName: "consulta",
        })
        .returning({ id: services.id });
      if (doctor === undefined || service === undefined) {
        throw new Error("No se creó la configuración de atención");
      }
      const [offer] = await transaction
        .insert(serviceOffers)
        .values({
          bufferMinutes: 5,
          clinicId: clinic.id,
          doctorId: doctor.id,
          durationMinutes: 30,
          priceUsd: "35.00",
          serviceId: service.id,
        })
        .returning({ id: serviceOffers.id });
      const [schedule] = await transaction
        .insert(effectiveSchedules)
        .values({
          clinicId: clinic.id,
          doctorId: doctor.id,
          effectiveFrom: "2026-08-01",
          timezone: "America/El_Salvador",
        })
        .returning({ id: effectiveSchedules.id });
      if (offer === undefined || schedule === undefined) {
        throw new Error("No se creó la Oferta u Horario vigente");
      }
      await transaction.insert(effectiveSchedulePeriods).values({
        clinicId: clinic.id,
        dayOfWeek: 1,
        doctorId: doctor.id,
        endTime: "10:00",
        scheduleId: schedule.id,
        startTime: "08:00",
      });
      const [contact] = await transaction
        .insert(contacts)
        .values({
          clinicId: clinic.id,
          name: "Ana Martínez",
          phoneE164: "+50371234567",
        })
        .returning({ id: contacts.id });
      const [patient] = await transaction
        .insert(patients)
        .values({
          birthDate: "2018-04-02",
          clinicId: clinic.id,
          name: "Lucía Martínez",
        })
        .returning({ id: patients.id });
      if (contact === undefined || patient === undefined) {
        throw new Error("No se creó la ficha administrativa");
      }
      await transaction.insert(contactPatientLinks).values({
        clinicId: clinic.id,
        contactId: contact.id,
        patientId: patient.id,
      });
      return {
        clinicId: clinic.id,
        contactId: contact.id,
        doctorId: doctor.id,
        ownerClinicUserId: ownerMember.id,
        patientId: patient.id,
        secretaryClinicUserId: secretaryMember.id,
        serviceOfferId: offer.id,
      };
    },
  );
  const other = await inSuperadminTransaction(
    ids.superadmin,
    async (transaction) => {
      const [clinic] = await transaction
        .insert(clinics)
        .values({ isSynthetic: true, name: "Clínica externa APO-39" })
        .returning({ id: clinics.id });
      if (clinic === undefined)
        throw new Error("No se creó la Clínica externa");
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${clinic.id}, true)`,
      );
      await transaction.insert(clinicUsers).values({
        clinicId: clinic.id,
        identityId: ids.otherOwner,
        role: "owner",
      });
      return { clinicId: clinic.id };
    },
  );

  return {
    ...primary,
    otherClinicId: other.clinicId,
    doctorIdentityId: ids.doctor,
    otherOwnerIdentityId: ids.otherOwner,
    ownerIdentityId: ids.owner,
    secretaryIdentityId: ids.secretary,
    async cleanup() {
      for (const clinicId of [primary.clinicId, other.clinicId]) {
        await inSuperadminTransaction(ids.superadmin, async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${clinicId}, true)`,
          );
          await transaction
            .delete(appointmentEvents)
            .where(eq(appointmentEvents.clinicId, clinicId));
          await transaction
            .delete(appointments)
            .where(eq(appointments.clinicId, clinicId));
          await transaction.delete(clinics).where(eq(clinics.id, clinicId));
        });
      }
      await db
        .delete(apoloSuperadmins)
        .where(eq(apoloSuperadmins.identityId, ids.superadmin));
      await db
        .delete(identities)
        .where(
          and(eq(identities.id, ids.owner), eq(identities.id, ids.doctor)),
        );
      await db.delete(identities).where(eq(identities.id, ids.owner));
      await db.delete(identities).where(eq(identities.id, ids.doctor));
      await db.delete(identities).where(eq(identities.id, ids.secretary));
      await db.delete(identities).where(eq(identities.id, ids.otherOwner));
      await db.delete(identities).where(eq(identities.id, ids.superadmin));
    },
  };
}
