import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "~/server/db";
import {
  inClinicTransaction,
  inSuperadminTransaction,
} from "~/server/db/clinic-context";
import { drizzleWhatsAppProvisioningStore } from "~/server/db/whatsapp-provisioning-store";
import {
  apoloSuperadmins,
  clinicUsers,
  clinics,
  user as identities,
  whatsappConnections,
  whatsappWebhookEvents,
} from "~/server/db/schema";
import {
  receiveKapsoWebhook,
  runKapsoProvisioningWorker,
  type KapsoProvisioningProvider,
} from "./whatsapp-provisioning";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("persistencia y RLS de provisión Kapso", () => {
  databaseTest(
    "registra idempotencia, aísla Clínicas y conserva una asociación única",
    async () => {
      const fixture = await createFixture();
      try {
        const payload = {
          business_account_id: fixture.primary.businessAccountId,
          customer: { id: fixture.primary.customer },
          display_phone_number: "+50370000000",
          phone_number_id: fixture.primary.phoneNumberId,
          project: { id: fixture.primary.projectId },
        };
        await expect(
          receiveKapsoWebhook({
            eventName: "whatsapp.phone_number.created",
            idempotencyKey: fixture.idempotencyKey,
            payload,
            store: drizzleWhatsAppProvisioningStore,
          }),
        ).resolves.toMatchObject({ accepted: true });
        await expect(
          receiveKapsoWebhook({
            eventName: "whatsapp.phone_number.created",
            idempotencyKey: fixture.idempotencyKey,
            payload,
            store: drizzleWhatsAppProvisioningStore,
          }),
        ).resolves.toEqual({ accepted: false, eventId: "duplicate" });
        await expect(
          receiveKapsoWebhook({
            eventName: "whatsapp.message.received",
            idempotencyKey: fixture.ignoredIdempotencyKey,
            payload: { id: "message-1" },
            store: drizzleWhatsAppProvisioningStore,
          }),
        ).resolves.toMatchObject({ accepted: true });

        const provider: KapsoProvisioningProvider = {
          getPhoneNumber: async () => ({
            businessAccountId: fixture.primary.businessAccountId,
            customerId: fixture.primary.customer,
            displayPhoneE164: "+50370000000",
            phoneNumberId: fixture.primary.phoneNumberId,
          }),
          ensureProjectWebhook: async () => ({ remoteId: "project-hook" }),
          ensurePhoneNumberWebhook: async () => ({ remoteId: "phone-hook" }),
        };
        const workerResult = await runKapsoProvisioningWorker(
          { now: new Date("2026-09-07T12:00:00.000Z") },
          drizzleWhatsAppProvisioningStore,
          provider,
        );
        const eventRecord = await db
          .select({ lastError: whatsappWebhookEvents.lastError })
          .from(whatsappWebhookEvents)
          .where(
            eq(whatsappWebhookEvents.idempotencyKey, fixture.idempotencyKey),
          );
        expect(workerResult).toEqual({
          claimed: 1,
          processed: 1,
          rejected: 0,
          retried: 0,
        });
        expect(eventRecord).toEqual([{ lastError: null }]);
        await expect(
          db
            .select({ status: whatsappWebhookEvents.status })
            .from(whatsappWebhookEvents)
            .where(
              eq(
                whatsappWebhookEvents.idempotencyKey,
                fixture.ignoredIdempotencyKey,
              ),
            ),
        ).resolves.toEqual([{ status: "ignored" }]);

        await expect(
          receiveKapsoWebhook({
            eventName: "whatsapp.phone_number.created",
            idempotencyKey: fixture.leaseIdempotencyKey,
            payload,
            store: drizzleWhatsAppProvisioningStore,
          }),
        ).resolves.toMatchObject({ accepted: true });
        const firstClaim =
          await drizzleWhatsAppProvisioningStore.claimDueEvents({
            limit: 1,
            now: new Date("2026-09-07T12:00:00.000Z"),
          });
        const firstLease = firstClaim[0];
        if (firstLease?.leaseToken === null || firstLease === undefined) {
          throw new Error("Falta el primer lease de prueba");
        }
        const secondClaim =
          await drizzleWhatsAppProvisioningStore.claimDueEvents({
            limit: 1,
            now: new Date("2026-09-07T12:11:00.000Z"),
          });
        const secondLease = secondClaim[0];
        if (secondLease?.leaseToken === null || secondLease === undefined) {
          throw new Error("Falta el segundo lease de prueba");
        }
        await drizzleWhatsAppProvisioningStore.markProcessed({
          eventId: firstLease.id,
          leaseToken: firstLease.leaseToken,
          processedAt: new Date("2026-09-07T12:11:01.000Z"),
        });
        await expect(
          db
            .select({ status: whatsappWebhookEvents.status })
            .from(whatsappWebhookEvents)
            .where(eq(whatsappWebhookEvents.id, firstLease.id)),
        ).resolves.toEqual([{ status: "processing" }]);
        await drizzleWhatsAppProvisioningStore.markProcessed({
          eventId: secondLease.id,
          leaseToken: secondLease.leaseToken,
          processedAt: new Date("2026-09-07T12:11:02.000Z"),
        });

        await expect(
          inClinicTransaction(
            {
              clinicId: fixture.primary.clinicId,
              identityId: fixture.primary.identityId,
            },
            (transaction) =>
              transaction.query.whatsappConnections.findFirst({
                where: eq(
                  whatsappConnections.clinicId,
                  fixture.primary.clinicId,
                ),
              }),
          ),
        ).resolves.toMatchObject({
          businessAccountId: fixture.primary.businessAccountId,
          phoneNumberId: fixture.primary.phoneNumberId,
          status: "provisioning",
        });
        await expect(
          inClinicTransaction(
            {
              clinicId: fixture.primary.clinicId,
              identityId: fixture.primary.doctorIdentityId,
            },
            (transaction) => transaction.query.whatsappConnections.findMany(),
          ),
        ).resolves.toEqual([]);
        await expect(
          inClinicTransaction(
            {
              clinicId: fixture.other.clinicId,
              identityId: fixture.other.identityId,
            },
            (transaction) => transaction.query.whatsappConnections.findMany(),
          ),
        ).resolves.toHaveLength(1);

        try {
          await inSuperadminTransaction(
            fixture.superadminIdentityId,
            (transaction) =>
              transaction
                .update(whatsappConnections)
                .set({ businessAccountId: fixture.primary.businessAccountId })
                .where(
                  eq(whatsappConnections.clinicId, fixture.other.clinicId),
                ),
          );
          throw new Error("La asociación WABA duplicada fue aceptada");
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

async function createFixture() {
  const suffix = randomUUID();
  const superadminIdentityId = `apo-85-superadmin-${suffix}`;
  const primaryIdentityId = `apo-85-primary-${suffix}`;
  const primaryDoctorIdentityId = `apo-85-doctor-${suffix}`;
  const otherIdentityId = `apo-85-other-${suffix}`;
  const primaryCustomer = `customer-apo-85-primary-${suffix}`;
  const otherCustomer = `customer-apo-85-other-${suffix}`;
  const primaryBusinessAccountId = `waba-apo-85-primary-${suffix}`;
  const primaryPhoneNumberId = `phone-apo-85-primary-${suffix}`;
  const projectId = `project-apo-85-${suffix}`;
  const idempotencyKey = `apo-85-event-${suffix}`;

  await db.insert(identities).values(
    [
      superadminIdentityId,
      primaryIdentityId,
      primaryDoctorIdentityId,
      otherIdentityId,
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

  const createClinic = async (input: {
    customer: string;
    identityId: string;
    name: string;
  }) =>
    inSuperadminTransaction(superadminIdentityId, async (transaction) => {
      const [clinic] = await transaction
        .insert(clinics)
        .values({ isSynthetic: true, name: input.name })
        .returning({ id: clinics.id });
      if (clinic === undefined) throw new Error("No se creó la Clínica");
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${clinic.id}, true)`,
      );
      await transaction.execute(
        sql`select set_config('app.subscription_status', 'active', true)`,
      );
      await transaction.insert(whatsappConnections).values({
        clinicId: clinic.id,
        connectionType: "coexistence",
        customer: input.customer,
        metadata: { mode: "coexistence" },
        provider: "kapso",
        status: "pending",
      });
      await transaction.insert(clinicUsers).values({
        clinicId: clinic.id,
        identityId: input.identityId,
        role: "owner",
      });
      return { clinicId: clinic.id, identityId: input.identityId };
    });

  const primary = await createClinic({
    customer: primaryCustomer,
    identityId: primaryIdentityId,
    name: "Clínica APO-85 primaria",
  });
  const other = await createClinic({
    customer: otherCustomer,
    identityId: otherIdentityId,
    name: "Clínica APO-85 otra",
  });
  await inSuperadminTransaction(superadminIdentityId, async (transaction) => {
    await transaction.insert(clinicUsers).values({
      clinicId: primary.clinicId,
      identityId: primaryDoctorIdentityId,
      role: "doctor",
    });
  });

  return {
    other: { ...other, identityId: other.identityId },
    primary: {
      ...primary,
      businessAccountId: primaryBusinessAccountId,
      customer: primaryCustomer,
      doctorIdentityId: primaryDoctorIdentityId,
      phoneNumberId: primaryPhoneNumberId,
      projectId,
    },
    idempotencyKey,
    ignoredIdempotencyKey: `${idempotencyKey}-message`,
    leaseIdempotencyKey: `${idempotencyKey}-lease`,
    superadminIdentityId,
    async cleanup() {
      await db
        .delete(whatsappWebhookEvents)
        .where(
          inArray(whatsappWebhookEvents.idempotencyKey, [
            idempotencyKey,
            `${idempotencyKey}-message`,
            `${idempotencyKey}-lease`,
          ]),
        );
      await inSuperadminTransaction(
        superadminIdentityId,
        async (transaction) => {
          await transaction
            .delete(clinics)
            .where(inArray(clinics.id, [primary.clinicId, other.clinicId]));
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
          ]),
        );
    },
  };
}
