import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  addServiceOffer,
  createService,
  deactivateServiceOffer,
  updateServiceOffer,
} from "./service-catalog";
import { deactivateDoctor } from "./doctor-status";
import { db } from "../db";
import {
  inClinicTransaction,
  inSuperadminTransaction,
} from "../db/clinic-context";
import {
  apoloSuperadmins,
  clinicUsers,
  clinics,
  configurationAuditEvents,
  doctors,
  appointments,
  serviceOffers,
  temporaryReservations,
  services,
  user as identities,
} from "../db/schema";
import {
  drizzleServiceCatalogStore,
  listServiceCatalog,
} from "../db/service-catalog-store";
import { drizzleDoctorStatusStore } from "../db/doctor-status-store";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("catálogo y Ofertas de servicio persistentes", () => {
  databaseTest(
    "protege la desactivación de un Médico, conserva su historial y aísla por RLS",
    async () => {
      const fixture = await createCatalogFixture();

      try {
        const additionalDoctorId = fixture.aurora.doctorIds[1];
        if (
          additionalDoctorId === undefined ||
          fixture.aurora.additionalIdentityId === undefined
        ) {
          throw new Error("Falta el Médico adicional");
        }
        await inClinicTransaction(fixture.aurora, async (transaction) => {
          await transaction.insert(appointments).values({
            clinicId: fixture.aurora.clinicId,
            doctorId: additionalDoctorId,
            endsAt: new Date(Date.now() + 3_600_000),
            startsAt: new Date(Date.now() + 1_800_000),
          });
          await transaction.insert(temporaryReservations).values({
            clinicId: fixture.aurora.clinicId,
            doctorId: additionalDoctorId,
            endsAt: new Date(Date.now() + 7_200_000),
            expiresAt: new Date(Date.now() + 3_600_000),
            startsAt: new Date(Date.now() + 5_400_000),
          });
        });

        await expect(
          deactivateDoctor(
            {
              clinicId: fixture.aurora.clinicId,
              doctorId: additionalDoctorId,
              identityId: fixture.aurora.identityId,
            },
            drizzleDoctorStatusStore,
          ),
        ).rejects.toMatchObject({
          conflicts: [
            expect.objectContaining({
              doctorId: additionalDoctorId,
              kind: "confirmed-appointment",
            }),
            expect.objectContaining({
              doctorId: additionalDoctorId,
              kind: "active-temporary-reservation",
            }),
          ],
        });
        await inClinicTransaction(fixture.aurora, async (transaction) => {
          await transaction
            .delete(appointments)
            .where(eq(appointments.doctorId, additionalDoctorId));
          await transaction
            .delete(temporaryReservations)
            .where(eq(temporaryReservations.doctorId, additionalDoctorId));
        });

        await expect(
          deactivateDoctor(
            {
              clinicId: fixture.aurora.clinicId,
              doctorId: additionalDoctorId,
              identityId: fixture.aurora.additionalIdentityId,
            },
            drizzleDoctorStatusStore,
          ),
        ).rejects.toThrow("Solo el Médico propietario");
        await expect(
          deactivateDoctor(
            {
              clinicId: fixture.aurora.clinicId,
              doctorId: additionalDoctorId,
              identityId: fixture.aurora.identityId,
            },
            drizzleDoctorStatusStore,
          ),
        ).resolves.toMatchObject({ active: false, id: additionalDoctorId });

        await inClinicTransaction(fixture.aurora, async (transaction) => {
          await expect(
            transaction.query.doctors.findFirst({
              columns: { active: true, deactivatedAt: true, id: true },
              where: eq(doctors.id, additionalDoctorId),
            }),
          ).resolves.toMatchObject({ active: false, id: additionalDoctorId });
          const audit =
            await transaction.query.configurationAuditEvents.findFirst({
              where: eq(configurationAuditEvents.entityId, additionalDoctorId),
            });
          expect(audit).toMatchObject({
            action: "doctor-deactivated",
            afterValues: { active: "false" },
            beforeValues: { active: "true" },
          });
        });
        await inClinicTransaction(fixture.cedro, async (transaction) => {
          await expect(
            transaction.query.doctors.findFirst({
              where: eq(doctors.id, additionalDoctorId),
            }),
          ).resolves.toBeUndefined();
          await expect(
            transaction
              .update(doctors)
              .set({ active: true })
              .where(eq(doctors.id, additionalDoctorId))
              .returning({ id: doctors.id }),
          ).resolves.toEqual([]);
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "rechaza desactivar una Oferta que dejaría Citas o Reservas activas sin capacidad",
    async () => {
      const fixture = await createCatalogFixture();

      try {
        const [ownerDoctorId, additionalDoctorId] = fixture.aurora.doctorIds;
        if (ownerDoctorId === undefined || additionalDoctorId === undefined) {
          throw new Error("Faltan los Médicos elegibles de la Clínica");
        }
        const service = await createService(
          {
            clinicId: fixture.aurora.clinicId,
            description: "Consulta médica general",
            identityId: fixture.aurora.identityId,
            name: "Consulta inicial",
            offers: [
              {
                bufferMinutes: 10,
                doctorId: ownerDoctorId,
                durationMinutes: 45,
                priceUsd: "35.00",
              },
            ],
          },
          drizzleServiceCatalogStore,
        );
        const offer = service.offers[0];
        if (offer === undefined) throw new Error("Falta la Oferta creada");
        await addServiceOffer(
          {
            bufferMinutes: 10,
            clinicId: fixture.aurora.clinicId,
            doctorId: additionalDoctorId,
            durationMinutes: 45,
            identityId: fixture.aurora.identityId,
            priceUsd: "35.00",
            serviceId: service.id,
          },
          drizzleServiceCatalogStore,
        );
        await inClinicTransaction(fixture.aurora, async (transaction) => {
          await transaction.insert(appointments).values({
            clinicId: fixture.aurora.clinicId,
            doctorId: ownerDoctorId,
            endsAt: new Date("2026-08-10T15:00:00.000Z"),
            startsAt: new Date("2026-08-10T14:00:00.000Z"),
          });
          await transaction.insert(temporaryReservations).values({
            clinicId: fixture.aurora.clinicId,
            doctorId: ownerDoctorId,
            endsAt: new Date("2026-08-10T17:00:00.000Z"),
            expiresAt: new Date("2030-01-01T00:00:00.000Z"),
            startsAt: new Date("2026-08-10T16:00:00.000Z"),
          });
        });

        await expect(
          deactivateServiceOffer(
            {
              clinicId: fixture.aurora.clinicId,
              identityId: fixture.aurora.identityId,
              offerId: offer.id,
            },
            drizzleServiceCatalogStore,
          ),
        ).rejects.toMatchObject({
          conflicts: [
            expect.objectContaining({
              doctorId: ownerDoctorId,
              kind: "confirmed-appointment",
            }),
            expect.objectContaining({
              doctorId: ownerDoctorId,
              kind: "active-temporary-reservation",
            }),
          ],
        });

        await inClinicTransaction(fixture.aurora, async (transaction) => {
          await expect(
            transaction.query.serviceOffers.findFirst({
              columns: { active: true },
              where: eq(serviceOffers.id, offer.id),
            }),
          ).resolves.toMatchObject({ active: true });
          const auditEvents =
            await transaction.query.configurationAuditEvents.findMany({
              columns: { action: true },
              where: eq(configurationAuditEvents.entityId, offer.id),
            });
          expect(
            auditEvents.some(
              (event) => event.action === "service-offer-deactivated",
            ),
          ).toBe(false);
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "permite desactivar una Oferta cuando la única Cita confirmada ya terminó",
    async () => {
      const fixture = await createCatalogFixture();

      try {
        const [ownerDoctorId, additionalDoctorId] = fixture.aurora.doctorIds;
        if (ownerDoctorId === undefined || additionalDoctorId === undefined) {
          throw new Error("Faltan los Médicos elegibles de la Clínica");
        }
        const service = await createService(
          {
            clinicId: fixture.aurora.clinicId,
            description: "Consulta médica general",
            identityId: fixture.aurora.identityId,
            name: "Consulta inicial",
            offers: [
              {
                bufferMinutes: 10,
                doctorId: ownerDoctorId,
                durationMinutes: 45,
                priceUsd: "35.00",
              },
            ],
          },
          drizzleServiceCatalogStore,
        );
        const offer = service.offers[0];
        if (offer === undefined) throw new Error("Falta la Oferta creada");
        await addServiceOffer(
          {
            bufferMinutes: 10,
            clinicId: fixture.aurora.clinicId,
            doctorId: additionalDoctorId,
            durationMinutes: 45,
            identityId: fixture.aurora.identityId,
            priceUsd: "35.00",
            serviceId: service.id,
          },
          drizzleServiceCatalogStore,
        );
        const endsAt = new Date(Date.now() - 60_000);
        await inClinicTransaction(fixture.aurora, (transaction) =>
          transaction.insert(appointments).values({
            clinicId: fixture.aurora.clinicId,
            doctorId: ownerDoctorId,
            endsAt,
            startsAt: new Date(endsAt.valueOf() - 30 * 60_000),
          }),
        );

        await expect(
          deactivateServiceOffer(
            {
              clinicId: fixture.aurora.clinicId,
              identityId: fixture.aurora.identityId,
              offerId: offer.id,
            },
            drizzleServiceCatalogStore,
          ),
        ).resolves.toMatchObject({ active: false, id: offer.id });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "persiste precio exacto, auditoría y RLS sin exponer otra Clínica",
    async () => {
      const fixture = await createCatalogFixture();

      try {
        const ownerDoctorId = fixture.aurora.doctorIds[0];
        const additionalDoctorId = fixture.aurora.doctorIds[1];
        if (
          ownerDoctorId === undefined ||
          additionalDoctorId === undefined ||
          fixture.aurora.additionalIdentityId === undefined
        ) {
          throw new Error("Faltan los Médicos elegibles de la Clínica");
        }
        const service = await createService(
          {
            clinicId: fixture.aurora.clinicId,
            description: "Consulta médica general",
            identityId: fixture.aurora.identityId,
            name: "  Consulta   inicial ",
            offers: [
              {
                bufferMinutes: 10,
                doctorId: ownerDoctorId,
                durationMinutes: 45,
                priceUsd: "35.00",
              },
            ],
          },
          drizzleServiceCatalogStore,
        );
        const firstOffer = service.offers[0];
        if (firstOffer === undefined) throw new Error("Falta la Oferta creada");
        const secondOffer = await addServiceOffer(
          {
            bufferMinutes: 0,
            clinicId: fixture.aurora.clinicId,
            doctorId: additionalDoctorId,
            durationMinutes: 45,
            identityId: fixture.aurora.identityId,
            priceUsd: "40.00",
            serviceId: service.id,
          },
          drizzleServiceCatalogStore,
        );

        await expect(
          updateServiceOffer(
            {
              bufferMinutes: 0,
              clinicId: fixture.aurora.clinicId,
              durationMinutes: 45,
              identityId: fixture.aurora.additionalIdentityId,
              offerId: secondOffer.id,
              priceUsd: "42.00",
            },
            drizzleServiceCatalogStore,
          ),
        ).resolves.toMatchObject({ id: secondOffer.id, priceUsd: "42.00" });
        await expect(
          updateServiceOffer(
            {
              bufferMinutes: 10,
              clinicId: fixture.aurora.clinicId,
              durationMinutes: 45,
              identityId: fixture.aurora.additionalIdentityId,
              offerId: firstOffer.id,
              priceUsd: "36.00",
            },
            drizzleServiceCatalogStore,
          ),
        ).rejects.toThrow("Solo el Médico propietario");

        await expect(
          updateServiceOffer(
            {
              bufferMinutes: 15,
              clinicId: fixture.aurora.clinicId,
              durationMinutes: 50,
              identityId: fixture.aurora.identityId,
              offerId: firstOffer.id,
              priceUsd: "45.00",
            },
            drizzleServiceCatalogStore,
          ),
        ).resolves.toMatchObject({
          bufferMinutes: 15,
          durationMinutes: 50,
          priceUsd: "45.00",
        });
        await expect(
          deactivateServiceOffer(
            {
              clinicId: fixture.aurora.clinicId,
              identityId: fixture.aurora.identityId,
              offerId: firstOffer.id,
            },
            drizzleServiceCatalogStore,
          ),
        ).resolves.toMatchObject({ active: false, id: firstOffer.id });

        const catalog = await listServiceCatalog(fixture.aurora);
        expect(catalog?.services).toHaveLength(1);
        expect(catalog?.services[0]).toMatchObject({
          name: "Consulta inicial",
        });
        expect(
          catalog?.services[0]?.offers.some(
            (offer) => !offer.active && offer.id === firstOffer.id,
          ),
        ).toBe(true);

        const audit = await inClinicTransaction(fixture.aurora, (transaction) =>
          transaction.query.configurationAuditEvents.findMany({
            where: eq(
              configurationAuditEvents.clinicId,
              fixture.aurora.clinicId,
            ),
          }),
        );
        expect(audit.some((event) => event.action === "service-created")).toBe(
          true,
        );
        expect(
          audit.some((event) => event.action === "service-offer-created"),
        ).toBe(true);
        expect(
          audit.some(
            (event) =>
              event.action === "service-offer-updated" &&
              event.afterValues?.priceUsd === "45.00",
          ),
        ).toBe(true);
        expect(
          audit.some(
            (event) =>
              event.action === "service-offer-deactivated" &&
              event.afterValues?.active === "false",
          ),
        ).toBe(true);

        await inClinicTransaction(fixture.cedro, async (transaction) => {
          await expect(
            transaction.query.services.findFirst({
              where: eq(services.id, service.id),
            }),
          ).resolves.toBeUndefined();
          await expect(
            transaction.query.serviceOffers.findFirst({
              where: eq(serviceOffers.id, firstOffer.id),
            }),
          ).resolves.toBeUndefined();
          await expect(
            transaction
              .update(serviceOffers)
              .set({ priceUsd: "99.00" })
              .where(eq(serviceOffers.id, firstOffer.id))
              .returning({ id: serviceOffers.id }),
          ).resolves.toEqual([]);
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

async function createCatalogFixture() {
  const superadminId = `apo-33-superadmin-${randomUUID()}`;
  const aurora = clinicalFixture("aurora");
  const cedro = clinicalFixture("cedro");

  await db.insert(identities).values([
    {
      id: superadminId,
      name: "Superadmin APO-33",
      email: `${superadminId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    ...[aurora, cedro].map((fixture) => ({
      id: fixture.identityId,
      name: `Propietario ${fixture.label} APO-33`,
      email: `${fixture.identityId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  ]);
  await db.insert(apoloSuperadmins).values({ identityId: superadminId });

  try {
    for (const fixture of [aurora, cedro]) {
      const [clinic] = await inSuperadminTransaction(
        superadminId,
        (transaction) =>
          transaction
            .insert(clinics)
            .values({ isSynthetic: true, name: `Clínica ${fixture.label}` })
            .returning({ id: clinics.id }),
      );
      if (clinic === undefined) throw new Error("No se creó la Clínica");
      fixture.clinicId = clinic.id;

      await inSuperadminTransaction(superadminId, async (transaction) => {
        await transaction.execute(
          sql`select set_config('app.clinic_id', ${clinic.id}, true)`,
        );
        const [owner] = await transaction
          .insert(clinicUsers)
          .values({
            clinicId: clinic.id,
            identityId: fixture.identityId,
            role: "owner",
          })
          .returning({ id: clinicUsers.id });
        if (owner === undefined) throw new Error("Falta el propietario");
        const [ownerDoctor] = await transaction
          .insert(doctors)
          .values({ clinicId: clinic.id, clinicUserId: owner.id })
          .returning({ id: doctors.id });
        if (ownerDoctor === undefined)
          throw new Error("Falta el Médico propietario");
        fixture.doctorIds.push(ownerDoctor.id);

        if (fixture === aurora) {
          const doctorIdentityId = `apo-33-doctor-${randomUUID()}`;
          await db.insert(identities).values({
            id: doctorIdentityId,
            name: "Médico adicional APO-33",
            email: `${doctorIdentityId}@example.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          fixture.additionalIdentityId = doctorIdentityId;
          const [doctorUser] = await transaction
            .insert(clinicUsers)
            .values({
              clinicId: clinic.id,
              identityId: doctorIdentityId,
              role: "doctor",
            })
            .returning({ id: clinicUsers.id });
          if (doctorUser === undefined)
            throw new Error("Falta el Médico adicional");
          const [doctor] = await transaction
            .insert(doctors)
            .values({ clinicId: clinic.id, clinicUserId: doctorUser.id })
            .returning({ id: doctors.id });
          if (doctor === undefined)
            throw new Error("Falta el perfil adicional");
          fixture.doctorIds.push(doctor.id);
        }
      });
    }

    return {
      aurora: requiredContext(aurora),
      cedro: requiredContext(cedro),
      async cleanup() {
        for (const fixture of [aurora, cedro]) {
          if (fixture.clinicId === undefined) continue;
          const clinicId = fixture.clinicId;
          await inSuperadminTransaction(superadminId, async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${clinicId}, true)`,
            );
            await transaction
              .delete(configurationAuditEvents)
              .where(eq(configurationAuditEvents.clinicId, clinicId));
            await transaction.delete(clinics).where(eq(clinics.id, clinicId));
          });
        }
        await db
          .delete(apoloSuperadmins)
          .where(eq(apoloSuperadmins.identityId, superadminId));
        if (aurora.additionalIdentityId !== undefined) {
          await db
            .delete(identities)
            .where(eq(identities.id, aurora.additionalIdentityId));
        }
        await db.delete(identities).where(eq(identities.id, aurora.identityId));
        await db.delete(identities).where(eq(identities.id, cedro.identityId));
        await db.delete(identities).where(eq(identities.id, superadminId));
      },
    };
  } catch (error) {
    await db
      .delete(apoloSuperadmins)
      .where(eq(apoloSuperadmins.identityId, superadminId));
    await db.delete(identities).where(eq(identities.id, aurora.identityId));
    await db.delete(identities).where(eq(identities.id, cedro.identityId));
    await db.delete(identities).where(eq(identities.id, superadminId));
    throw error;
  }
}

function clinicalFixture(label: string) {
  return {
    additionalIdentityId: undefined as string | undefined,
    clinicId: undefined as string | undefined,
    doctorIds: [] as string[],
    identityId: `apo-33-${label}-${randomUUID()}`,
    label,
  };
}

function requiredContext(fixture: ReturnType<typeof clinicalFixture>) {
  if (fixture.clinicId === undefined) throw new Error("Falta la Clínica");
  return {
    additionalIdentityId: fixture.additionalIdentityId,
    clinicId: fixture.clinicId,
    doctorIds: fixture.doctorIds,
    identityId: fixture.identityId,
  };
}
