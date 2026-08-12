import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { processSimulatedWhatsAppMessage } from "./simulated-whatsapp-booking";
import { db } from "../db";
import {
  inClinicTransaction,
  inSuperadminTransaction,
} from "../db/clinic-context";
import { drizzleSimulatedWhatsAppBookingStore } from "../db/simulated-whatsapp-booking-store";
import {
  appointments,
  apoloSuperadmins,
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
        const confirmations = await Promise.all([
          processSimulatedWhatsAppMessage(
            message(fixture, "message-5", "confirmar"),
            drizzleSimulatedWhatsAppBookingStore,
            now,
          ),
          processSimulatedWhatsAppMessage(
            message(fixture, "message-6", "confirmar"),
            drizzleSimulatedWhatsAppBookingStore,
            now,
          ),
        ]);
        expect(confirmations).toContainEqual(
          expect.objectContaining({
            kind: "appointment-confirmed",
            origin: "reservation",
            patientId: fixture.patientId,
          }),
        );
        expect(
          confirmations.filter(
            (response) => response.kind === "appointment-confirmed",
          ),
        ).toHaveLength(1);
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
    return { offerId: offer.id, patientId: patient.id };
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
