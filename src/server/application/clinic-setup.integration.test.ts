import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { configureEffectiveSchedule } from "./availability";
import { completeOwnDoctorProfile } from "./doctor-profile";
import {
  declareClinicReady,
  getClinicSetup,
  saveClinicSetupStep,
  updateClinicBasics,
} from "./clinic-setup";
import { createService } from "./service-catalog";
import { deactivateDoctor } from "./doctor-status";
import { db } from "../db";
import {
  inClinicTransaction,
  inSimulatedWhatsAppClinicTransaction,
  inSuperadminTransaction,
} from "../db/clinic-context";
import { drizzleAvailabilityStore } from "../db/availability-store";
import { drizzleDoctorStatusStore } from "../db/doctor-status-store";
import { drizzleServiceCatalogStore } from "../db/service-catalog-store";
import { drizzleSimulatedWhatsAppBookingStore } from "../db/simulated-whatsapp-booking-store";
import {
  apoloSuperadmins,
  clinicReadiness,
  clinicUsers,
  clinics,
  configurationAuditEvents,
  doctors,
  user as identities,
} from "../db/schema";
import {
  CLINIC_TERMS_ACCEPTANCE_ERROR_MESSAGE,
  CLINIC_TERMS_VERSION,
} from "../../domain/clinic-setup";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("Configuración inicial y preparación de Asclepio", () => {
  databaseTest(
    "recalcula una ruta dentro de RLS, conserva el aislamiento y detiene ofertas al perderla",
    async () => {
      const fixture = await createFixture();
      try {
        const initial = await getClinicSetup(fixture.primary);
        expect(initial.readiness).toEqual({
          asclepioEnabled: false,
          status: "pending",
        });
        expect(initial.blockers.map((blocker) => blocker.code)).toEqual(
          expect.arrayContaining(["services", "availability", "team"]),
        );
        await updateClinicBasics({
          clinicId: fixture.primary.clinicId,
          identityId: fixture.primary.identityId,
          name: " Clínica APO-65 actualizada ",
        });
        await saveClinicSetupStep({
          clinicId: fixture.primary.clinicId,
          identityId: fixture.primary.identityId,
          step: "availability",
        });
        const resumed = await getClinicSetup(fixture.primary);
        expect(resumed).toMatchObject({
          clinicName: "Clínica APO-65 actualizada",
          currentStep: "availability",
        });

        const profile = await completeOwnDoctorProfile({
          clinicId: fixture.primary.clinicId,
          identityId: fixture.primary.identityId,
          primarySpecialty: "Medicina general",
          publicName: "Dra. Aurora APO-65",
        });
        await createService(
          {
            clinicId: fixture.primary.clinicId,
            description: "Consulta de prueba para la ruta inicial",
            identityId: fixture.primary.identityId,
            name: "Consulta APO-65",
            offers: [
              {
                bufferMinutes: 0,
                doctorId: profile.id,
                durationMinutes: 30,
                priceUsd: "35.00",
              },
            ],
          },
          drizzleServiceCatalogStore,
        );
        await configureEffectiveSchedule(
          {
            clinicId: fixture.primary.clinicId,
            doctorId: profile.id,
            effectiveFrom: localDate(new Date()),
            identityId: fixture.primary.identityId,
            periods: [{ dayOfWeek: 1, endTime: "10:00", startTime: "08:00" }],
          },
          drizzleAvailabilityStore,
        );

        const calculated = await getClinicSetup(fixture.primary);
        expect(calculated.readiness).toEqual({
          asclepioEnabled: false,
          status: "ready",
        });
        expect(calculated.firstValidRoute).toMatchObject({
          doctor: { name: "Dra. Aurora APO-65" },
          service: { name: "Consulta APO-65" },
        });

        await expect(
          declareClinicReady({
            ...fixture.primary,
            termsAcceptance: null,
          }),
        ).rejects.toThrow(CLINIC_TERMS_ACCEPTANCE_ERROR_MESSAGE);
        await expect(
          declareClinicReady({
            ...fixture.primary,
            termsAcceptance: { version: "0.9" },
          }),
        ).rejects.toThrow(CLINIC_TERMS_ACCEPTANCE_ERROR_MESSAGE);
        await expect(getClinicSetup(fixture.primary)).resolves.toMatchObject({
          readiness: { asclepioEnabled: false, status: "ready" },
          termsAcceptance: {
            accepted: false,
            version: null,
          },
        });

        const declared = await declareClinicReady({
          ...fixture.primary,
          termsAcceptance: { version: CLINIC_TERMS_VERSION },
        });
        expect(declared.readiness).toEqual({
          asclepioEnabled: true,
          status: "ready",
        });
        const readiness = await inClinicTransaction(
          fixture.primary,
          (transaction) =>
            transaction.query.clinicReadiness.findFirst({
              columns: {
                termsAcceptedAt: true,
                termsAcceptedByIdentityId: true,
                termsAcceptedVersion: true,
              },
              where: eq(clinicReadiness.clinicId, fixture.primary.clinicId),
            }),
        );
        if (readiness === undefined) {
          throw new Error("Falta la aceptación de Términos de la Clínica");
        }
        expect(readiness.termsAcceptedAt).toBeInstanceOf(Date);
        expect(readiness.termsAcceptedByIdentityId).toBe(
          fixture.primary.identityId,
        );
        expect(readiness.termsAcceptedVersion).toBe(CLINIC_TERMS_VERSION);

        await expect(
          inClinicTransaction(fixture.primary, (transaction) =>
            transaction.query.configurationAuditEvents.findFirst({
              columns: {
                action: true,
                actorIdentityId: true,
                afterValues: true,
                entity: true,
              },
              where: and(
                eq(configurationAuditEvents.clinicId, fixture.primary.clinicId),
                eq(configurationAuditEvents.action, "clinic-terms-accepted"),
              ),
            }),
          ),
        ).resolves.toMatchObject({
          action: "clinic-terms-accepted",
          actorIdentityId: fixture.primary.identityId,
          afterValues: {
            termsAccepted: "true",
            termsVersion: CLINIC_TERMS_VERSION,
          },
          entity: "clinic-terms",
        });

        const otherReadiness = await inClinicTransaction(
          fixture.primary,
          (transaction) =>
            transaction.query.clinicReadiness.findFirst({
              where: eq(clinicReadiness.clinicId, fixture.other.clinicId),
            }),
        );
        expect(otherReadiness).toBeUndefined();

        await deactivateDoctor(
          {
            clinicId: fixture.primary.clinicId,
            doctorId: profile.id,
            identityId: fixture.primary.identityId,
          },
          drizzleDoctorStatusStore,
        );
        const pendingAgain = await getClinicSetup(fixture.primary);
        expect(pendingAgain.readiness).toEqual({
          asclepioEnabled: false,
          status: "pending",
        });
        await expect(
          drizzleSimulatedWhatsAppBookingStore.listPublicOffers({
            clinicId: fixture.primary.clinicId,
          }),
        ).resolves.toEqual([]);
        await completeOwnDoctorProfile({
          clinicId: fixture.primary.clinicId,
          identityId: fixture.replacementDoctorIdentityId,
          primarySpecialty: "Medicina interna",
          publicName: "Dr. Reemplazo APO-65",
        });
        await createService(
          {
            clinicId: fixture.primary.clinicId,
            description: "Consulta de recuperación de capacidad",
            identityId: fixture.primary.identityId,
            name: "Consulta recuperación APO-65",
            offers: [
              {
                bufferMinutes: 0,
                doctorId: fixture.replacementDoctorId,
                durationMinutes: 30,
                priceUsd: "40.00",
              },
            ],
          },
          drizzleServiceCatalogStore,
        );
        await configureEffectiveSchedule(
          {
            clinicId: fixture.primary.clinicId,
            doctorId: fixture.replacementDoctorId,
            effectiveFrom: localDate(new Date()),
            identityId: fixture.primary.identityId,
            periods: [{ dayOfWeek: 1, endTime: "12:00", startTime: "10:00" }],
          },
          drizzleAvailabilityStore,
        );
        const restored = await getClinicSetup(fixture.primary);
        expect(restored).toMatchObject({
          firstValidRoute: {
            doctor: { name: "Dr. Reemplazo APO-65" },
            service: { name: "Consulta recuperación APO-65" },
          },
          readiness: { asclepioEnabled: false, status: "ready" },
        });
        await expect(
          drizzleSimulatedWhatsAppBookingStore.listPublicOffers({
            clinicId: fixture.primary.clinicId,
          }),
        ).resolves.toEqual([]);
        await expect(
          inSimulatedWhatsAppClinicTransaction(
            fixture.primary.clinicId,
            async (transaction) =>
              transaction.query.clinicReadiness.findFirst({
                where: eq(clinicReadiness.clinicId, fixture.primary.clinicId),
              }),
          ),
        ).resolves.toMatchObject({ asclepioEnabled: false });
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

async function createFixture() {
  const suffix = randomUUID();
  const ownerIdentityId = `apo-65-owner-${suffix}`;
  const otherIdentityId = `apo-65-other-${suffix}`;
  const replacementDoctorIdentityId = `apo-65-replacement-doctor-${suffix}`;
  const superadminIdentityId = `apo-65-superadmin-${suffix}`;
  await db.insert(identities).values(
    [
      ownerIdentityId,
      otherIdentityId,
      replacementDoctorIdentityId,
      superadminIdentityId,
    ].map((id) => ({
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

  const createClinic = (identityId: string, name: string) =>
    inSuperadminTransaction(superadminIdentityId, async (transaction) => {
      const [clinic] = await transaction
        .insert(clinics)
        .values({
          isSynthetic: true,
          name,
          whatsappNumberE164: `+5037${Date.now().toString().slice(-7)}`,
        })
        .returning({ id: clinics.id });
      if (clinic === undefined) throw new Error("No se creó la Clínica");
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${clinic.id}, true)`,
      );
      await transaction.insert(clinicReadiness).values({ clinicId: clinic.id });
      await transaction.insert(clinicUsers).values({
        clinicId: clinic.id,
        identityId,
        role: "owner",
      });
      return { clinicId: clinic.id, identityId };
    });

  const primary = await createClinic(ownerIdentityId, "Clínica APO-65");
  const other = await createClinic(otherIdentityId, "Otra Clínica APO-65");
  const replacementDoctor = await inSuperadminTransaction(
    superadminIdentityId,
    async (transaction) => {
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${primary.clinicId}, true)`,
      );
      const [member] = await transaction
        .insert(clinicUsers)
        .values({
          clinicId: primary.clinicId,
          identityId: replacementDoctorIdentityId,
          role: "doctor",
        })
        .returning({ id: clinicUsers.id });
      if (member === undefined) throw new Error("Falta el Médico de reemplazo");
      const [doctor] = await transaction
        .insert(doctors)
        .values({ clinicId: primary.clinicId, clinicUserId: member.id })
        .returning({ id: doctors.id });
      if (doctor === undefined)
        throw new Error("No se creó el Médico de reemplazo");
      return { id: doctor.id };
    },
  );
  await inClinicTransaction(primary, async (transaction) => {
    const owner = await transaction.query.clinicUsers.findFirst({
      columns: { id: true },
      where: and(
        eq(clinicUsers.clinicId, primary.clinicId),
        eq(clinicUsers.identityId, primary.identityId),
      ),
    });
    if (owner === undefined) throw new Error("Falta el propietario");
    await transaction.insert(doctors).values({
      clinicId: primary.clinicId,
      clinicUserId: owner.id,
    });
  });

  return {
    other,
    primary,
    replacementDoctorId: replacementDoctor.id,
    replacementDoctorIdentityId,
    async cleanup() {
      await inSuperadminTransaction(superadminIdentityId, (transaction) =>
        transaction.delete(clinics).where(eq(clinics.id, primary.clinicId)),
      );
      await inSuperadminTransaction(superadminIdentityId, (transaction) =>
        transaction.delete(clinics).where(eq(clinics.id, other.clinicId)),
      );
      await db
        .delete(apoloSuperadmins)
        .where(eq(apoloSuperadmins.identityId, superadminIdentityId));
      await db
        .delete(identities)
        .where(
          sql`${identities.id} in (${ownerIdentityId}, ${otherIdentityId}, ${replacementDoctorIdentityId}, ${superadminIdentityId})`,
        );
    },
  };
}

function localDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/El_Salvador",
    year: "numeric",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
