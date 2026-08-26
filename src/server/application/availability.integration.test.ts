import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  CapacityConflictError,
  configureEffectiveSchedule,
  createAvailabilityBlock,
  createAvailabilityBlocks,
} from "./availability";
import { calculateCareOptions } from "./care-options";
import { createService } from "./service-catalog";
import { db } from "../db";
import {
  inClinicTransaction,
  inSuperadminTransaction,
} from "../db/clinic-context";
import {
  drizzleAvailabilityStore,
  drizzleCareOptionsStore,
  listAvailabilityConfiguration,
} from "../db/availability-store";
import { drizzleServiceCatalogStore } from "../db/service-catalog-store";
import {
  appointments,
  apoloSuperadmins,
  availabilityBlocks,
  clinicUsers,
  clinics,
  configurationAuditEvents,
  doctors,
  effectiveSchedules,
  temporaryReservations,
  user as identities,
} from "../db/schema";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("Horarios vigentes y Bloqueos persistentes", () => {
  databaseTest(
    "calcula Opciones desde las tablas protegidas por RLS sin materializar slots",
    async () => {
      const fixture = await createFixture();
      const secretaryIdentityId = `apo-35-secretary-${randomUUID()}`;
      try {
        await db.insert(identities).values({
          id: secretaryIdentityId,
          name: "Secretaria APO-35",
          email: `${secretaryIdentityId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            await transaction.insert(clinicUsers).values({
              active: true,
              clinicId: fixture.clinicId,
              identityId: secretaryIdentityId,
              role: "secretary",
            });
          },
        );
        const service = await createService(
          {
            clinicId: fixture.clinicId,
            description: "Consulta para calcular Opciones",
            identityId: fixture.ownerIdentityId,
            name: "Consulta Agenda",
            offers: [
              {
                bufferMinutes: 15,
                doctorId: fixture.ownerDoctorId,
                durationMinutes: 30,
                priceUsd: "35.00",
              },
            ],
          },
          drizzleServiceCatalogStore,
        );
        await configureEffectiveSchedule(
          {
            clinicId: fixture.clinicId,
            doctorId: fixture.ownerDoctorId,
            effectiveFrom: "2026-08-01",
            identityId: fixture.ownerIdentityId,
            periods: [{ dayOfWeek: 1, endTime: "12:00", startTime: "08:00" }],
          },
          drizzleAvailabilityStore,
        );
        await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.ownerIdentityId },
          async (transaction) => {
            await transaction.insert(appointments).values({
              clinicId: fixture.clinicId,
              doctorId: fixture.ownerDoctorId,
              endsAt: new Date("2026-08-10T14:30:00.000Z"),
              startsAt: new Date("2026-08-10T05:50:00.000Z"),
            });
            await transaction.insert(temporaryReservations).values([
              {
                clinicId: fixture.clinicId,
                doctorId: fixture.ownerDoctorId,
                endsAt: new Date("2026-08-10T17:00:00.000Z"),
                expiresAt: new Date("2030-01-01T00:00:00.000Z"),
                startsAt: new Date("2026-08-10T16:00:00.000Z"),
              },
              {
                clinicId: fixture.clinicId,
                doctorId: fixture.ownerDoctorId,
                endsAt: new Date("2026-08-10T18:00:00.000Z"),
                expiresAt: new Date("2026-08-10T13:00:00.000Z"),
                startsAt: new Date("2026-08-10T17:00:00.000Z"),
              },
            ]);
          },
        );
        await createAvailabilityBlock(
          {
            clinicId: fixture.clinicId,
            doctorId: fixture.ownerDoctorId,
            endsAt: new Date("2026-08-10T16:00:00.000Z"),
            identityId: fixture.ownerIdentityId,
            privateLabel: "Reunión privada",
            startsAt: new Date("2026-08-10T15:00:00.000Z"),
          },
          drizzleAvailabilityStore,
        );

        const options = await calculateCareOptions(
          {
            clinicId: fixture.clinicId,
            doctorId: fixture.ownerDoctorId,
            from: "2026-08-10",
            identityId: fixture.ownerIdentityId,
            serviceId: service.id,
            to: "2026-08-10",
          },
          drizzleCareOptionsStore,
          new Date("2026-08-10T13:00:00.000Z"),
        );
        expect(options.map((option) => option.startsAt.toISOString())).toEqual([
          "2026-08-10T17:00:00.000Z",
          "2026-08-10T17:05:00.000Z",
          "2026-08-10T17:10:00.000Z",
          "2026-08-10T17:15:00.000Z",
        ]);
        expect(options.every((option) => !("privateLabel" in option))).toBe(
          true,
        );
        await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.ownerIdentityId },
          (transaction) =>
            transaction
              .update(appointments)
              .set({ status: "cancelled" })
              .where(eq(appointments.clinicId, fixture.clinicId)),
        );
        await expect(
          calculateCareOptions(
            {
              clinicId: fixture.clinicId,
              doctorId: fixture.ownerDoctorId,
              from: "2026-08-10",
              identityId: fixture.ownerIdentityId,
              serviceId: service.id,
              to: "2026-08-10",
            },
            drizzleCareOptionsStore,
            new Date("2026-08-10T13:00:00.000Z"),
          ),
        ).resolves.toEqual(
          expect.arrayContaining([
            { startsAt: new Date("2026-08-10T14:00:00.000Z") },
          ]),
        );
        await expect(
          calculateCareOptions(
            {
              clinicId: fixture.otherClinicId,
              doctorId: fixture.ownerDoctorId,
              from: "2026-08-10",
              identityId: fixture.otherClinicOwnerId,
              serviceId: service.id,
              to: "2026-08-10",
            },
            drizzleCareOptionsStore,
          ),
        ).resolves.toEqual([]);
        await expect(
          listAvailabilityConfiguration({
            clinicId: fixture.clinicId,
            identityId: secretaryIdentityId,
          }),
        ).resolves.toBeUndefined();
        await expect(
          calculateCareOptions(
            {
              clinicId: fixture.clinicId,
              doctorId: fixture.ownerDoctorId,
              from: "2026-08-10",
              identityId: secretaryIdentityId,
              serviceId: service.id,
              to: "2026-08-10",
            },
            drizzleCareOptionsStore,
          ),
        ).resolves.toEqual([]);

        const primaryOffer = service.offers[0];
        if (primaryOffer === undefined)
          throw new Error("Falta la Oferta activa");
        await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.ownerIdentityId },
          (transaction) =>
            transaction
              .update(doctors)
              .set({ active: false, deactivatedAt: new Date() })
              .where(eq(doctors.id, fixture.ownerDoctorId)),
        );
        await expect(
          calculateCareOptions(
            {
              clinicId: fixture.clinicId,
              doctorId: fixture.ownerDoctorId,
              from: "2026-08-10",
              identityId: fixture.ownerIdentityId,
              serviceId: service.id,
              to: "2026-08-10",
            },
            drizzleCareOptionsStore,
          ),
        ).resolves.toEqual([]);
      } finally {
        await fixture.cleanup();
        await db
          .delete(identities)
          .where(eq(identities.id, secretaryIdentityId));
      }
    },
  );

  databaseTest(
    "protege permisos, vigencias, conflictos, auditoría y RLS",
    async () => {
      const fixture = await createFixture();
      try {
        await configureEffectiveSchedule(
          {
            clinicId: fixture.clinicId,
            doctorId: fixture.ownerDoctorId,
            effectiveFrom: "2026-08-01",
            identityId: fixture.ownerIdentityId,
            periods: [{ dayOfWeek: 1, endTime: "12:00", startTime: "08:00" }],
          },
          drizzleAvailabilityStore,
        );
        await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.ownerIdentityId },
          async (transaction) => {
            await transaction.insert(appointments).values({
              clinicId: fixture.clinicId,
              doctorId: fixture.ownerDoctorId,
              endsAt: new Date("2026-08-10T15:00:00.000Z"),
              startsAt: new Date("2026-08-10T14:00:00.000Z"),
            });
            await transaction.insert(temporaryReservations).values({
              clinicId: fixture.clinicId,
              doctorId: fixture.ownerDoctorId,
              endsAt: new Date("2026-08-10T17:00:00.000Z"),
              expiresAt: new Date("2030-01-01T00:00:00.000Z"),
              startsAt: new Date("2026-08-10T16:00:00.000Z"),
            });
          },
        );

        await expect(
          configureEffectiveSchedule(
            {
              clinicId: fixture.clinicId,
              doctorId: fixture.ownerDoctorId,
              effectiveFrom: "2026-08-10",
              identityId: fixture.ownerIdentityId,
              periods: [{ dayOfWeek: 1, endTime: "12:00", startTime: "09:00" }],
            },
            drizzleAvailabilityStore,
          ),
        ).rejects.toMatchObject({
          conflicts: [
            expect.objectContaining({
              doctorId: fixture.ownerDoctorId,
              kind: "confirmed-appointment",
            }),
          ],
        });
        await expect(
          configureEffectiveSchedule(
            {
              clinicId: fixture.clinicId,
              doctorId: fixture.ownerDoctorId,
              effectiveFrom: "2026-08-10",
              identityId: fixture.ownerIdentityId,
              periods: [{ dayOfWeek: 1, endTime: "10:00", startTime: "08:00" }],
            },
            drizzleAvailabilityStore,
          ),
        ).rejects.toMatchObject({
          conflicts: [
            expect.objectContaining({
              doctorId: fixture.ownerDoctorId,
              kind: "active-temporary-reservation",
            }),
          ],
        });
        await expect(
          createAvailabilityBlock(
            {
              clinicId: fixture.clinicId,
              doctorId: fixture.ownerDoctorId,
              endsAt: new Date("2026-08-10T14:30:00.000Z"),
              identityId: fixture.ownerIdentityId,
              startsAt: new Date("2026-08-10T13:30:00.000Z"),
            },
            drizzleAvailabilityStore,
          ),
        ).rejects.toBeInstanceOf(CapacityConflictError);
        await expect(
          configureEffectiveSchedule(
            {
              clinicId: fixture.clinicId,
              doctorId: fixture.ownerDoctorId,
              effectiveFrom: "2026-08-10",
              identityId: fixture.ownerIdentityId,
              periods: [{ dayOfWeek: 1, endTime: "12:00", startTime: "08:00" }],
            },
            drizzleAvailabilityStore,
          ),
        ).resolves.toMatchObject({ effectiveFrom: "2026-08-10" });
        await expect(
          createAvailabilityBlock(
            {
              clinicId: fixture.clinicId,
              doctorId: fixture.ownerDoctorId,
              endsAt: new Date("2026-08-11T16:00:00.000Z"),
              identityId: fixture.doctorIdentityId,
              startsAt: new Date("2026-08-11T14:00:00.000Z"),
            },
            drizzleAvailabilityStore,
          ),
        ).rejects.toThrow("La Identidad no puede configurar");

        await expect(
          createAvailabilityBlocks(
            {
              clinicId: fixture.clinicId,
              doctorIds: [fixture.ownerDoctorId, fixture.otherDoctorId],
              endsAt: new Date("2026-08-11T16:00:00.000Z"),
              identityId: fixture.ownerIdentityId,
              privateLabel: "Vacaciones",
              startsAt: new Date("2026-08-11T14:00:00.000Z"),
            },
            drizzleAvailabilityStore,
          ),
        ).resolves.toHaveLength(2);
        const ownerView = await listAvailabilityConfiguration({
          clinicId: fixture.clinicId,
          identityId: fixture.ownerIdentityId,
        });
        if (ownerView === undefined) {
          throw new Error("Falta la vista del propietario");
        }
        expect(
          ownerView.blocks.every(
            (block) => block.privateLabel === "Vacaciones",
          ),
        ).toBe(true);
        const doctorView = await listAvailabilityConfiguration({
          clinicId: fixture.clinicId,
          identityId: fixture.doctorIdentityId,
        });
        if (doctorView === undefined) {
          throw new Error("Falta la vista de disponibilidad");
        }
        expect(
          doctorView.blocks.some(
            (block) => block.doctorId === fixture.ownerDoctorId,
          ),
        ).toBe(false);
        expect(doctorView.doctors.map((doctor) => doctor.id)).toEqual([
          fixture.otherDoctorId,
        ]);
        await inClinicTransaction(
          {
            clinicId: fixture.otherClinicId,
            identityId: fixture.otherClinicOwnerId,
          },
          async (transaction) => {
            await expect(
              transaction.query.effectiveSchedules.findMany({
                where: eq(effectiveSchedules.clinicId, fixture.clinicId),
              }),
            ).resolves.toEqual([]);
            await expect(
              transaction.query.availabilityBlocks.findMany({
                where: eq(availabilityBlocks.clinicId, fixture.clinicId),
              }),
            ).resolves.toEqual([]);
          },
        );
        const audit = await inClinicTransaction(
          { clinicId: fixture.clinicId, identityId: fixture.ownerIdentityId },
          (transaction) =>
            transaction.query.configurationAuditEvents.findMany({
              where: eq(configurationAuditEvents.clinicId, fixture.clinicId),
            }),
        );
        expect(
          audit.some((event) => event.action === "effective-schedule-created"),
        ).toBe(true);
        expect(
          audit.some((event) => event.action === "effective-schedule-closed"),
        ).toBe(true);
        expect(
          audit.filter(
            (event) => event.action === "availability-block-created",
          ),
        ).toHaveLength(2);
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

async function createFixture() {
  const suffix = randomUUID();
  const ids = {
    superadmin: `apo-34-superadmin-${suffix}`,
    owner: `apo-34-owner-${suffix}`,
    doctor: `apo-34-doctor-${suffix}`,
    otherOwner: `apo-34-other-owner-${suffix}`,
  };
  await db.insert(identities).values(
    Object.entries(ids).map(([key, id]) => ({
      id,
      name: key,
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
  await db.insert(apoloSuperadmins).values({ identityId: ids.superadmin });
  const createClinic = async (identityId: string, name: string) =>
    inSuperadminTransaction(ids.superadmin, async (transaction) => {
      const [clinic] = await transaction
        .insert(clinics)
        .values({ isSynthetic: true, name })
        .returning({ id: clinics.id });
      if (!clinic) throw new Error("Falta Clínica");
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${clinic.id}, true)`,
      );
      const [user] = await transaction
        .insert(clinicUsers)
        .values({ clinicId: clinic.id, identityId, role: "owner" })
        .returning({ id: clinicUsers.id });
      if (!user) throw new Error("Falta propietario");
      const [doctor] = await transaction
        .insert(doctors)
        .values({ clinicId: clinic.id, clinicUserId: user.id })
        .returning({ id: doctors.id });
      if (!doctor) throw new Error("Falta Médico");
      return { clinicId: clinic.id, doctorId: doctor.id };
    });
  const primary = await createClinic(ids.owner, "Clínica APO-34");
  const other = await createClinic(ids.otherOwner, "Clínica externa APO-34");
  const otherDoctorId = await inSuperadminTransaction(
    ids.superadmin,
    async (transaction) => {
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${primary.clinicId}, true)`,
      );
      const [user] = await transaction
        .insert(clinicUsers)
        .values({
          clinicId: primary.clinicId,
          identityId: ids.doctor,
          role: "doctor",
        })
        .returning({ id: clinicUsers.id });
      if (!user) throw new Error("Falta usuario Médico");
      const [doctor] = await transaction
        .insert(doctors)
        .values({ clinicId: primary.clinicId, clinicUserId: user.id })
        .returning({ id: doctors.id });
      if (!doctor) throw new Error("Falta segundo Médico");
      return doctor.id;
    },
  );
  return {
    clinicId: primary.clinicId,
    ownerDoctorId: primary.doctorId,
    ownerIdentityId: ids.owner,
    doctorIdentityId: ids.doctor,
    otherDoctorId,
    otherClinicId: other.clinicId,
    otherClinicOwnerId: ids.otherOwner,
    superadminIdentityId: ids.superadmin,
    async cleanup() {
      for (const clinicId of [primary.clinicId, other.clinicId])
        await inSuperadminTransaction(ids.superadmin, async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${clinicId}, true)`,
          );
          await transaction
            .delete(configurationAuditEvents)
            .where(eq(configurationAuditEvents.clinicId, clinicId));
          await transaction.delete(clinics).where(eq(clinics.id, clinicId));
        });
      await db
        .delete(apoloSuperadmins)
        .where(eq(apoloSuperadmins.identityId, ids.superadmin));
      await db.delete(identities).where(and(eq(identities.id, ids.superadmin)));
      await db.delete(identities).where(eq(identities.id, ids.owner));
      await db.delete(identities).where(eq(identities.id, ids.doctor));
      await db.delete(identities).where(eq(identities.id, ids.otherOwner));
    },
  };
}
