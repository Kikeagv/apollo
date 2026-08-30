import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  PanaceaConfigurationAccessError,
  getPanaceaConfigurationOverview,
} from "./panacea-configuration";
import { PanaceaTeamAccessError, listPanaceaTeam } from "./panacea-team";
import { createSyntheticClinic } from "./create-synthetic-clinic";
import { inSuperadminTransaction } from "../db/clinic-context";
import { db } from "../db";
import {
  apoloSuperadmins,
  clinicUsers,
  clinics,
  doctors,
  effectiveSchedulePeriods,
  effectiveSchedules,
  serviceOffers,
  services,
  user as identities,
} from "../db/schema";
import { drizzleSyntheticClinicRegistration } from "../db/synthetic-clinic-registration";
import { sendSimulatedClinicOwnerInvitation } from "../email/simulated-identity-email";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("índice y Equipo de Panacea con roles y RLS", () => {
  databaseTest(
    "el propietario ve el Equipo completo, el Médico solo su alcance y la Secretaria queda fuera",
    async () => {
      const fixture = await createFixture();

      try {
        const team = await listPanaceaTeam({
          clinicId: fixture.clinicId,
          identityId: fixture.ownerIdentityId,
        });
        const doctor = team.doctors.find(
          (candidate) =>
            candidate.email === `${fixture.doctorIdentityId}@example.test`,
        );
        const owner = team.doctors.find(
          (candidate) =>
            candidate.email === `${fixture.ownerIdentityId}@example.test`,
        );
        expect(doctor?.profile.status).toBe("incomplete");
        expect(owner).toBeDefined();

        await expect(
          listPanaceaTeam({
            clinicId: fixture.clinicId,
            identityId: fixture.doctorIdentityId,
          }),
        ).rejects.toBeInstanceOf(PanaceaTeamAccessError);

        const doctorOverview = await getPanaceaConfigurationOverview({
          clinicId: fixture.clinicId,
          identityId: fixture.doctorIdentityId,
        });
        expect(doctorOverview).toMatchObject({
          team: { activeDoctors: 1, completedProfiles: 0 },
        });
        expect(
          doctorOverview.areas.find((area) => area.id === "availability"),
        ).toMatchObject({
          progress: { completed: 0, total: 2 },
          status: "not-started",
        });
        expect(
          doctorOverview.areas.find((area) => area.id === "services"),
        ).toMatchObject({
          progress: { completed: 0, total: 2 },
          status: "not-started",
        });

        const ownerOverview = await getPanaceaConfigurationOverview({
          clinicId: fixture.clinicId,
          identityId: fixture.ownerIdentityId,
        });
        expect(ownerOverview).toMatchObject({
          team: { activeDoctors: 2, completedProfiles: 1 },
        });
        expect(
          ownerOverview.areas.find((area) => area.id === "availability"),
        ).toMatchObject({
          progress: { completed: 0, total: 2 },
          status: "not-started",
        });
        expect(
          ownerOverview.areas.find((area) => area.id === "services"),
        ).toMatchObject({
          progress: { completed: 0, total: 2 },
          status: "not-started",
        });

        await expect(
          getPanaceaConfigurationOverview({
            clinicId: fixture.clinicId,
            identityId: fixture.secretaryIdentityId,
          }),
        ).rejects.toBeInstanceOf(PanaceaConfigurationAccessError);
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

async function createFixture() {
  const suffix = randomUUID();
  const ids = {
    doctor: `apo-62-doctor-${suffix}`,
    owner: `apo-62-owner-${suffix}`,
    secretary: `apo-62-secretary-${suffix}`,
    superadmin: `apo-62-superadmin-${suffix}`,
  };

  await db.insert(identities).values(
    Object.values(ids).map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
  await db.insert(apoloSuperadmins).values({ identityId: ids.superadmin });

  const clinic = await createSyntheticClinic(
    {
      actorIdentityId: ids.superadmin,
      clinicName: `Clínica APO-62 ${suffix}`,
      owner: {
        email: `${ids.owner}@example.test`,
        name: "Médico propietario APO-62",
      },
    },
    {
      registry: drizzleSyntheticClinicRegistration,
      sendOwnerInvitation: sendSimulatedClinicOwnerInvitation,
    },
  );

  const memberships = await inSuperadminTransaction(
    ids.superadmin,
    async (transaction) => {
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${clinic.id}, true)`,
      );
      const [owner] = await transaction
        .insert(clinicUsers)
        .values({ clinicId: clinic.id, identityId: ids.owner, role: "owner" })
        .returning({ id: clinicUsers.id });
      const [doctor] = await transaction
        .insert(clinicUsers)
        .values({ clinicId: clinic.id, identityId: ids.doctor, role: "doctor" })
        .returning({ id: clinicUsers.id });
      await transaction.insert(clinicUsers).values({
        clinicId: clinic.id,
        identityId: ids.secretary,
        role: "secretary",
      });
      if (owner === undefined || doctor === undefined) {
        throw new Error("Falta la membresía de prueba");
      }

      await transaction.insert(doctors).values([
        {
          clinicId: clinic.id,
          clinicUserId: owner.id,
          primarySpecialty: "Medicina familiar",
          publicName: "Médico propietario APO-62",
        },
        { clinicId: clinic.id, clinicUserId: doctor.id },
      ]);
      const [service] = await transaction
        .insert(services)
        .values({
          clinicId: clinic.id,
          description: "Servicio de prueba para un perfil incompleto",
          name: `Servicio APO-62 ${suffix}`,
          normalizedName: `servicio apo-62 ${suffix}`,
        })
        .returning({ id: services.id });
      const [incompleteDoctor] = await transaction
        .select({ id: doctors.id })
        .from(doctors)
        .where(eq(doctors.clinicUserId, doctor.id));
      const [schedule] = incompleteDoctor
        ? await transaction
            .insert(effectiveSchedules)
            .values({
              clinicId: clinic.id,
              doctorId: incompleteDoctor.id,
              effectiveFrom: new Date().toISOString().slice(0, 10),
              timezone: "America/El_Salvador",
            })
            .returning({ id: effectiveSchedules.id })
        : [];
      if (service === undefined || incompleteDoctor === undefined) {
        throw new Error("Falta la capacidad de prueba");
      }
      await transaction.insert(serviceOffers).values({
        bufferMinutes: 0,
        clinicId: clinic.id,
        doctorId: incompleteDoctor.id,
        durationMinutes: 30,
        priceUsd: "25.00",
        serviceId: service.id,
      });
      if (schedule === undefined) throw new Error("Falta el Horario de prueba");
      await transaction.insert(effectiveSchedulePeriods).values(
        Array.from({ length: 7 }, (_, dayOfWeek) => ({
          clinicId: clinic.id,
          dayOfWeek,
          doctorId: incompleteDoctor.id,
          endTime: "09:00",
          scheduleId: schedule.id,
          startTime: "08:00",
        })),
      );
      return { clinicId: clinic.id };
    },
  );

  return {
    clinicId: memberships.clinicId,
    doctorIdentityId: ids.doctor,
    ownerIdentityId: ids.owner,
    secretaryIdentityId: ids.secretary,
    async cleanup() {
      await inSuperadminTransaction(ids.superadmin, async (transaction) => {
        await transaction
          .delete(clinics)
          .where(eq(clinics.id, memberships.clinicId));
      });
      await db
        .delete(apoloSuperadmins)
        .where(eq(apoloSuperadmins.identityId, ids.superadmin));
      await db
        .delete(identities)
        .where(inArray(identities.id, Object.values(ids)));
    },
  };
}
