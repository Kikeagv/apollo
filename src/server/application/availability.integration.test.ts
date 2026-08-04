import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { configureEffectiveSchedule, createAvailabilityBlock, createAvailabilityBlocks } from "./availability";
import { db } from "../db";
import { inClinicTransaction, inSuperadminTransaction } from "../db/clinic-context";
import { CapacityConflictError, drizzleAvailabilityStore, listAvailabilityConfiguration } from "../db/availability-store";
import { appointments, apoloSuperadmins, availabilityBlocks, clinicUsers, clinics, configurationAuditEvents, doctors, effectiveSchedules, temporaryReservations, user as identities } from "../db/schema";

const databaseTest = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("Horarios vigentes y Bloqueos persistentes", () => {
  databaseTest("protege permisos, vigencias, conflictos, auditoría y RLS", async () => {
    const fixture = await createFixture();
    try {
      await configureEffectiveSchedule({ clinicId: fixture.clinicId, doctorId: fixture.ownerDoctorId, effectiveFrom: "2026-08-01", identityId: fixture.ownerIdentityId, periods: [{ dayOfWeek: 1, endTime: "12:00", startTime: "08:00" }] }, drizzleAvailabilityStore);
      await inClinicTransaction({ clinicId: fixture.clinicId, identityId: fixture.ownerIdentityId }, async (transaction) => {
        await transaction.insert(appointments).values({ clinicId: fixture.clinicId, doctorId: fixture.ownerDoctorId, endsAt: new Date("2026-08-10T15:00:00.000Z"), startsAt: new Date("2026-08-10T14:00:00.000Z") });
        await transaction.insert(temporaryReservations).values({ clinicId: fixture.clinicId, doctorId: fixture.ownerDoctorId, endsAt: new Date("2026-08-10T17:00:00.000Z"), expiresAt: new Date("2030-01-01T00:00:00.000Z"), startsAt: new Date("2026-08-10T16:00:00.000Z") });
      });

      await expect(configureEffectiveSchedule({ clinicId: fixture.clinicId, doctorId: fixture.ownerDoctorId, effectiveFrom: "2026-08-10", identityId: fixture.ownerIdentityId, periods: [{ dayOfWeek: 1, endTime: "12:00", startTime: "09:00" }] }, drizzleAvailabilityStore)).rejects.toBeInstanceOf(CapacityConflictError);
      await expect(configureEffectiveSchedule({ clinicId: fixture.clinicId, doctorId: fixture.ownerDoctorId, effectiveFrom: "2026-08-10", identityId: fixture.ownerIdentityId, periods: [{ dayOfWeek: 1, endTime: "10:00", startTime: "08:00" }] }, drizzleAvailabilityStore)).rejects.toBeInstanceOf(CapacityConflictError);
      await expect(createAvailabilityBlock({ clinicId: fixture.clinicId, doctorId: fixture.ownerDoctorId, endsAt: new Date("2026-08-10T14:30:00.000Z"), identityId: fixture.ownerIdentityId, startsAt: new Date("2026-08-10T13:30:00.000Z") }, drizzleAvailabilityStore)).rejects.toBeInstanceOf(CapacityConflictError);
      await expect(configureEffectiveSchedule({ clinicId: fixture.clinicId, doctorId: fixture.ownerDoctorId, effectiveFrom: "2026-08-10", identityId: fixture.ownerIdentityId, periods: [{ dayOfWeek: 1, endTime: "12:00", startTime: "08:00" }] }, drizzleAvailabilityStore)).resolves.toMatchObject({ effectiveFrom: "2026-08-10" });
      await expect(createAvailabilityBlock({ clinicId: fixture.clinicId, doctorId: fixture.ownerDoctorId, endsAt: new Date("2026-08-11T16:00:00.000Z"), identityId: fixture.doctorIdentityId, startsAt: new Date("2026-08-11T14:00:00.000Z") }, drizzleAvailabilityStore)).rejects.toThrow("La Identidad no puede configurar");

      await expect(createAvailabilityBlocks({ clinicId: fixture.clinicId, doctorIds: [fixture.ownerDoctorId, fixture.otherDoctorId], endsAt: new Date("2026-08-11T16:00:00.000Z"), identityId: fixture.ownerIdentityId, privateLabel: "Vacaciones", startsAt: new Date("2026-08-11T14:00:00.000Z") }, drizzleAvailabilityStore)).resolves.toHaveLength(2);
      const ownerView = await listAvailabilityConfiguration({ clinicId: fixture.clinicId, identityId: fixture.ownerIdentityId });
      expect(ownerView.blocks.every((block) => block.privateLabel === "Vacaciones")).toBe(true);
      const doctorView = await listAvailabilityConfiguration({ clinicId: fixture.clinicId, identityId: fixture.doctorIdentityId });
      expect(doctorView.blocks.some((block) => block.doctorId === fixture.ownerDoctorId)).toBe(false);
      await inClinicTransaction({ clinicId: fixture.otherClinicId, identityId: fixture.otherClinicOwnerId }, async (transaction) => {
        await expect(transaction.query.effectiveSchedules.findMany({ where: eq(effectiveSchedules.clinicId, fixture.clinicId) })).resolves.toEqual([]);
        await expect(transaction.query.availabilityBlocks.findMany({ where: eq(availabilityBlocks.clinicId, fixture.clinicId) })).resolves.toEqual([]);
      });
      const audit = await inClinicTransaction({ clinicId: fixture.clinicId, identityId: fixture.ownerIdentityId }, (transaction) => transaction.query.configurationAuditEvents.findMany({ where: eq(configurationAuditEvents.clinicId, fixture.clinicId) }));
      expect(audit.some((event) => event.action === "effective-schedule-created")).toBe(true);
      expect(audit.some((event) => event.action === "effective-schedule-closed")).toBe(true);
      expect(audit.filter((event) => event.action === "availability-block-created")).toHaveLength(2);
    } finally { await fixture.cleanup(); }
  });
});

async function createFixture() {
  const suffix = randomUUID();
  const ids = { superadmin: `apo-34-superadmin-${suffix}`, owner: `apo-34-owner-${suffix}`, doctor: `apo-34-doctor-${suffix}`, otherOwner: `apo-34-other-owner-${suffix}` };
  await db.insert(identities).values(Object.entries(ids).map(([key, id]) => ({ id, name: key, email: `${id}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() })));
  await db.insert(apoloSuperadmins).values({ identityId: ids.superadmin });
  const createClinic = async (identityId: string, name: string) => inSuperadminTransaction(ids.superadmin, async (transaction) => {
    const [clinic] = await transaction.insert(clinics).values({ isSynthetic: true, name }).returning({ id: clinics.id });
    if (!clinic) throw new Error("Falta Clínica");
    await transaction.execute(sql`select set_config('app.clinic_id', ${clinic.id}, true)`);
    const [user] = await transaction.insert(clinicUsers).values({ clinicId: clinic.id, identityId, role: "owner" }).returning({ id: clinicUsers.id });
    if (!user) throw new Error("Falta propietario");
    const [doctor] = await transaction.insert(doctors).values({ clinicId: clinic.id, clinicUserId: user.id }).returning({ id: doctors.id });
    if (!doctor) throw new Error("Falta Médico");
    return { clinicId: clinic.id, doctorId: doctor.id };
  });
  const primary = await createClinic(ids.owner, "Clínica APO-34");
  const other = await createClinic(ids.otherOwner, "Clínica externa APO-34");
  const otherDoctorId = await inSuperadminTransaction(ids.superadmin, async (transaction) => {
    await transaction.execute(sql`select set_config('app.clinic_id', ${primary.clinicId}, true)`);
    const [user] = await transaction.insert(clinicUsers).values({ clinicId: primary.clinicId, identityId: ids.doctor, role: "doctor" }).returning({ id: clinicUsers.id });
    if (!user) throw new Error("Falta usuario Médico");
    const [doctor] = await transaction.insert(doctors).values({ clinicId: primary.clinicId, clinicUserId: user.id }).returning({ id: doctors.id });
    if (!doctor) throw new Error("Falta segundo Médico");
    return doctor.id;
  });
  return { clinicId: primary.clinicId, ownerDoctorId: primary.doctorId, ownerIdentityId: ids.owner, doctorIdentityId: ids.doctor, otherDoctorId, otherClinicId: other.clinicId, otherClinicOwnerId: ids.otherOwner, async cleanup() { for (const clinicId of [primary.clinicId, other.clinicId]) await inSuperadminTransaction(ids.superadmin, async (transaction) => { await transaction.execute(sql`select set_config('app.clinic_id', ${clinicId}, true)`); await transaction.delete(configurationAuditEvents).where(eq(configurationAuditEvents.clinicId, clinicId)); await transaction.delete(clinics).where(eq(clinics.id, clinicId)); }); await db.delete(apoloSuperadmins).where(eq(apoloSuperadmins.identityId, ids.superadmin)); await db.delete(identities).where(and(eq(identities.id, ids.superadmin))); await db.delete(identities).where(eq(identities.id, ids.owner)); await db.delete(identities).where(eq(identities.id, ids.doctor)); await db.delete(identities).where(eq(identities.id, ids.otherOwner)); } };
}
