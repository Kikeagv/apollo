import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createSimulatedWhatsAppConnection } from "~/domain/whatsapp-connection";
import { getWhatsAppConnection } from "./whatsapp-connections";
import {
  inClinicTransaction,
  inSimulatedWhatsAppInboundTransaction,
  inSuperadminTransaction,
} from "../db/clinic-context";
import { db } from "../db";
import { requireWhatsAppConnectionReady } from "../db/whatsapp-connection-store";
import {
  apoloSuperadmins,
  clinicUsers,
  clinics,
  user as identities,
  whatsappConnections,
} from "../db/schema";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("Conexiones de WhatsApp persistentes", () => {
  databaseTest(
    "aísla conexiones por Clínica, conserva estados y rechaza identificadores reutilizados",
    async () => {
      const fixture = await createFixture();

      try {
        await expect(
          getWhatsAppConnection({
            clinicId: fixture.primary.clinicId,
            identityId: fixture.primary.identityId,
          }),
        ).resolves.toMatchObject({
          clinicId: fixture.primary.clinicId,
          connectionType: "simulated",
          customer: `simulated:${fixture.primary.clinicId}`,
          phoneNumberE164: fixture.primaryPhoneNumberE164,
          phoneNumberId: null,
          provider: "simulated",
          status: "ready",
        });

        const connection = await getWhatsAppConnection({
          clinicId: fixture.primary.clinicId,
          identityId: fixture.primary.identityId,
        });
        expect(JSON.stringify(connection)).not.toContain("secret");
        expect(JSON.stringify(connection)).not.toContain("token");

        await expect(
          getWhatsAppConnection({
            clinicId: fixture.absent.clinicId,
            identityId: fixture.absent.identityId,
          }),
        ).resolves.toBeUndefined();

        await expect(
          inClinicTransaction(fixture.primary, async (transaction) =>
            transaction
              .select({ clinicId: whatsappConnections.clinicId })
              .from(whatsappConnections)
              .where(
                inArray(whatsappConnections.clinicId, [
                  fixture.primary.clinicId,
                  fixture.other.clinicId,
                ]),
              ),
          ),
        ).resolves.toEqual([{ clinicId: fixture.primary.clinicId }]);
        await expect(
          inClinicTransaction(fixture.primaryDoctor, async (transaction) =>
            transaction
              .select({ clinicId: whatsappConnections.clinicId })
              .from(whatsappConnections),
          ),
        ).resolves.toEqual([]);

        await expect(
          getWhatsAppConnection({
            clinicId: fixture.primary.clinicId,
            identityId: fixture.other.identityId,
          }),
        ).rejects.toThrow("La Identidad no pertenece a la Clínica");

        await expect(
          inSimulatedWhatsAppInboundTransaction(
            fixture.primaryPhoneNumberE164,
            async ({ clinicId }) => clinicId,
          ),
        ).resolves.toBe(fixture.primary.clinicId);
        await expect(
          db.transaction(async (transaction) => {
            await transaction.execute(
              sql`set local role panacea_clinical_access`,
            );
            await transaction.execute(
              sql`select set_config('app.whatsapp_inbound', 'true', true)`,
            );
            await transaction.execute(
              sql`select set_config('app.whatsapp_inbound_phone_e164', ${fixture.primaryPhoneNumberE164}, true)`,
            );
            return transaction.select({ clinicId: clinics.id }).from(clinics);
          }),
        ).resolves.toEqual([{ clinicId: fixture.primary.clinicId }]);

        await expect(
          requireWhatsAppConnectionReady({
            clinicId: fixture.primary.clinicId,
            provider: "simulated",
          }),
        ).resolves.toMatchObject({ status: "ready" });

        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.primary.clinicId}, true)`,
            );
            await transaction
              .update(whatsappConnections)
              .set({
                metadata: { mode: "simulated", health: "degraded" },
                status: "degraded",
                updatedAt: new Date("2026-09-05T13:00:00.000Z"),
              })
              .where(
                eq(whatsappConnections.clinicId, fixture.primary.clinicId),
              );
          },
        );
        await expect(
          getWhatsAppConnection({
            clinicId: fixture.primary.clinicId,
            identityId: fixture.primary.identityId,
          }),
        ).resolves.toMatchObject({ status: "degraded" });
        await expect(
          requireWhatsAppConnectionReady({
            clinicId: fixture.primary.clinicId,
            provider: "simulated",
          }),
        ).rejects.toThrow("no tiene una Conexión de WhatsApp lista");
        await expect(
          requireWhatsAppConnectionReady({
            clinicId: fixture.absent.clinicId,
            provider: "simulated",
          }),
        ).rejects.toThrow("no tiene una Conexión de WhatsApp lista");

        const sharedPhone = "+50370000999";
        await updateConnection(fixture, fixture.primary.clinicId, {
          phoneNumberE164: sharedPhone,
        });
        try {
          await updateConnection(fixture, fixture.other.clinicId, {
            phoneNumberE164: sharedPhone,
          });
          throw new Error("La conexión duplicada no fue rechazada");
        } catch (error) {
          const cause = (error as Error & { cause?: Error }).cause;
          expect(`${(error as Error).message} ${cause?.message ?? ""}`).toMatch(
            /duplicate key|unique/i,
          );
        }
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

async function updateConnection(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  clinicId: string,
  values: Partial<typeof whatsappConnections.$inferInsert>,
) {
  return inSuperadminTransaction(
    fixture.superadminIdentityId,
    async (transaction) => {
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${clinicId}, true)`,
      );
      return transaction
        .update(whatsappConnections)
        .set(values)
        .where(eq(whatsappConnections.clinicId, clinicId));
    },
  );
}

async function createFixture() {
  const suffix = randomUUID();
  const superadminIdentityId = `apo-82-superadmin-${suffix}`;
  const primaryIdentityId = `apo-82-primary-${suffix}`;
  const primaryDoctorIdentityId = `apo-82-doctor-${suffix}`;
  const otherIdentityId = `apo-82-other-${suffix}`;
  const absentIdentityId = `apo-82-absent-${suffix}`;
  const primaryPhoneNumberE164 = `+5037${suffix.replaceAll("-", "").slice(0, 7)}`;

  await db.insert(identities).values(
    [
      superadminIdentityId,
      primaryIdentityId,
      primaryDoctorIdentityId,
      otherIdentityId,
      absentIdentityId,
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

  const createClinic = (
    identityId: string,
    name: string,
    phoneNumberE164?: string,
    withConnection = true,
  ) =>
    inSuperadminTransaction(superadminIdentityId, async (transaction) => {
      const [clinic] = await transaction
        .insert(clinics)
        .values({
          isSynthetic: true,
          name,
        })
        .returning({ id: clinics.id });
      if (clinic === undefined) throw new Error("No se creó la Clínica");
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${clinic.id}, true)`,
      );
      await transaction.execute(
        sql`select set_config('app.subscription_status', 'active', true)`,
      );
      if (withConnection) {
        await transaction.insert(whatsappConnections).values({
          ...createSimulatedWhatsAppConnection(clinic.id),
          phoneNumberE164: phoneNumberE164 ?? null,
        });
      }
      await transaction.insert(clinicUsers).values({
        clinicId: clinic.id,
        identityId,
        role: "owner",
      });
      return { clinicId: clinic.id, identityId };
    });

  const primary = await createClinic(
    primaryIdentityId,
    "Clínica APO-82 primaria",
    primaryPhoneNumberE164,
  );
  const other = await createClinic(otherIdentityId, "Clínica APO-82 otra");
  const absent = await createClinic(
    absentIdentityId,
    "Clínica APO-82 sin conexión",
    undefined,
    false,
  );
  await inSuperadminTransaction(superadminIdentityId, async (transaction) => {
    await transaction.insert(clinicUsers).values({
      clinicId: primary.clinicId,
      identityId: primaryDoctorIdentityId,
      role: "doctor",
    });
  });

  return {
    absent,
    other,
    primary,
    primaryDoctor: {
      clinicId: primary.clinicId,
      identityId: primaryDoctorIdentityId,
    },
    primaryPhoneNumberE164,
    superadminIdentityId,
    async cleanup() {
      await inSuperadminTransaction(
        superadminIdentityId,
        async (transaction) => {
          for (const clinicId of [
            primary.clinicId,
            other.clinicId,
            absent.clinicId,
          ]) {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${clinicId}, true)`,
            );
            await transaction.delete(clinics).where(eq(clinics.id, clinicId));
          }
        },
      );
      await db
        .delete(apoloSuperadmins)
        .where(eq(apoloSuperadmins.identityId, superadminIdentityId));
      await db
        .delete(identities)
        .where(
          inArray(identities.id, [
            superadminIdentityId,
            primaryIdentityId,
            primaryDoctorIdentityId,
            otherIdentityId,
            absentIdentityId,
          ]),
        );
    },
  };
}
