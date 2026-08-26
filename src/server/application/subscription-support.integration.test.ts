import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createSubscriptionSupport } from "./subscription-support";
import { db } from "../db";
import {
  inClinicTransaction,
  inSimulatedWhatsAppInboundTransaction,
  inSuperadminTransaction,
} from "../db/clinic-context";
import {
  apoloAuditEvents,
  apoloSuperadmins,
  clinicSupportSessions,
  clinicUsers,
  clinics,
  patients,
  transferPayments,
  user as identities,
} from "../db/schema";
import {
  drizzleSubscriptionSupportStore,
  inAuditedSupportTransaction,
  listVisibleClinicSupportSessions,
  readAuditedSupportClinicSummary,
} from "../db/subscription-support-store";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("suscripción y soporte persistentes", () => {
  databaseTest(
    "suspende escritura y Asclepio, conserva lectura y exige soporte vigente aislado",
    async () => {
      const fixture = await createFixture();
      const subscriptionSupport = createSubscriptionSupport(
        drizzleSubscriptionSupportStore,
      );

      try {
        await inClinicTransaction(fixture.owner, async (transaction) => {
          await transaction.insert(patients).values({
            birthDate: "2000-01-01",
            clinicId: fixture.clinicId,
            name: "Paciente sintético de Aurora",
          });
        });
        await subscriptionSupport.recordTransferPayment({
          amountUsd: "75.00",
          clinicId: fixture.clinicId,
          recordedByIdentityId: fixture.superadminId,
          reference: "APO-24-TRX",
        });
        await subscriptionSupport.changeSubscriptionStatus({
          changedByIdentityId: fixture.superadminId,
          clinicId: fixture.clinicId,
          status: "suspended",
        });

        await expect(
          inClinicTransaction(fixture.owner, (transaction) =>
            transaction.insert(patients).values({
              birthDate: "2000-01-01",
              clinicId: fixture.clinicId,
              name: "No debe persistir",
            }),
          ),
        ).rejects.toThrow();
        await expect(
          inClinicTransaction(fixture.owner, (transaction) =>
            transaction.query.patients.findMany(),
          ),
        ).resolves.toEqual([
          expect.objectContaining({ name: "Paciente sintético de Aurora" }),
        ]);
        await expect(
          inSimulatedWhatsAppInboundTransaction(
            fixture.whatsappNumberE164,
            async () => "no debe responder",
          ),
        ).resolves.toBeUndefined();

        await subscriptionSupport.changeSubscriptionStatus({
          changedByIdentityId: fixture.superadminId,
          clinicId: fixture.clinicId,
          status: "active",
        });
        const supportSession = await subscriptionSupport.openSupportSession({
          clinicId: fixture.clinicId,
          expiresAt: new Date(Date.now() + 60_000),
          reason: "Revisar el incidente de agenda",
          superadminIdentityId: fixture.superadminId,
        });

        await expect(
          inAuditedSupportTransaction({
            clinicId: fixture.clinicId,
            operation: (transaction) => transaction.query.patients.findMany(),
            superadminIdentityId: fixture.superadminId,
            supportSessionId: supportSession.id,
          }),
        ).resolves.toEqual([]);
        await expect(
          readAuditedSupportClinicSummary({
            clinicId: fixture.clinicId,
            superadminIdentityId: fixture.superadminId,
            supportSessionId: supportSession.id,
          }),
        ).resolves.toEqual({
          name: "Clínica Aurora APO-24",
          subscriptionStatus: "active",
        });
        await expect(
          listVisibleClinicSupportSessions(fixture.owner),
        ).resolves.toEqual([
          expect.objectContaining({
            accesses: [expect.any(Date), expect.any(Date)],
            id: supportSession.id,
            reason: "Revisar el incidente de agenda",
          }),
        ]);
        await expect(
          inAuditedSupportTransaction({
            clinicId: fixture.otherClinicId,
            operation: async () => undefined,
            superadminIdentityId: fixture.superadminId,
            supportSessionId: supportSession.id,
          }),
        ).rejects.toThrow("La sesión de soporte no autoriza esta Clínica");

        const auditEvents = await inSuperadminTransaction(
          fixture.superadminId,
          (transaction) =>
            transaction.query.apoloAuditEvents.findMany({
              where: eq(apoloAuditEvents.clinicId, fixture.clinicId),
            }),
        );
        expect(auditEvents).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ action: "transfer-payment-recorded" }),
            expect.objectContaining({ action: "subscription-status-changed" }),
            expect.objectContaining({ action: "support-session-opened" }),
            expect.objectContaining({
              action: "support-access-used",
              supportSessionId: supportSession.id,
            }),
          ]),
        );
        await expect(
          inSuperadminTransaction(fixture.superadminId, (transaction) =>
            transaction.query.transferPayments.findMany({
              where: eq(transferPayments.clinicId, fixture.clinicId),
            }),
          ),
        ).resolves.toEqual([
          expect.objectContaining({
            amountUsd: "75.00",
            reference: "APO-24-TRX",
          }),
        ]);
        await inSuperadminTransaction(fixture.superadminId, (transaction) =>
          transaction
            .update(clinicSupportSessions)
            .set({ expiresAt: new Date(Date.now() - 1) })
            .where(eq(clinicSupportSessions.id, supportSession.id)),
        );
        await expect(
          listVisibleClinicSupportSessions(fixture.owner),
        ).resolves.toEqual([]);
        await expect(
          readAuditedSupportClinicSummary({
            clinicId: fixture.clinicId,
            superadminIdentityId: fixture.superadminId,
            supportSessionId: supportSession.id,
          }),
        ).rejects.toThrow("La sesión de soporte venció");
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

async function createFixture() {
  const suffix = randomUUID();
  const superadminId = `apo-24-superadmin-${suffix}`;
  const ownerId = `apo-24-owner-${suffix}`;
  const whatsappNumberE164 = `+5037${suffix.replaceAll("-", "").slice(0, 7)}`;

  await db.insert(identities).values([
    {
      createdAt: new Date(),
      email: `${superadminId}@example.test`,
      emailVerified: true,
      id: superadminId,
      name: "Superadmin APO-24",
      updatedAt: new Date(),
    },
    {
      createdAt: new Date(),
      email: `${ownerId}@example.test`,
      emailVerified: true,
      id: ownerId,
      name: "Propietario Aurora APO-24",
      updatedAt: new Date(),
    },
  ]);
  await db.insert(apoloSuperadmins).values({ identityId: superadminId });
  const clinic = await inSuperadminTransaction(
    superadminId,
    async (transaction) => {
      const [created] = await transaction
        .insert(clinics)
        .values({
          isSynthetic: true,
          name: "Clínica Aurora APO-24",
          whatsappNumberE164,
        })
        .returning({ id: clinics.id });
      if (created === undefined) throw new Error("No se creó la Clínica");
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${created.id}, true)`,
      );
      await transaction.execute(
        sql`select set_config('app.subscription_status', 'active', true)`,
      );
      await transaction.insert(clinicUsers).values({
        active: true,
        clinicId: created.id,
        identityId: ownerId,
        role: "owner",
      });
      return created;
    },
  );
  const clinicId = clinic.id;
  const otherClinic = await inSuperadminTransaction(
    superadminId,
    async (transaction) => {
      const [created] = await transaction
        .insert(clinics)
        .values({ isSynthetic: true, name: "Clínica Cedro APO-24" })
        .returning({ id: clinics.id });
      if (created === undefined)
        throw new Error("No se creó la segunda Clínica");
      return created;
    },
  );

  return {
    clinicId,
    owner: { clinicId, identityId: ownerId },
    otherClinicId: otherClinic.id,
    superadminId,
    whatsappNumberE164,
    async cleanup() {
      await inSuperadminTransaction(superadminId, async (transaction) => {
        await transaction
          .delete(apoloAuditEvents)
          .where(eq(apoloAuditEvents.clinicId, clinicId));
        await transaction
          .delete(transferPayments)
          .where(eq(transferPayments.clinicId, clinicId));
        await transaction.delete(clinics).where(eq(clinics.id, clinicId));
        await transaction.delete(clinics).where(eq(clinics.id, otherClinic.id));
      });
      await db
        .delete(apoloSuperadmins)
        .where(eq(apoloSuperadmins.identityId, superadminId));
      await db.delete(identities).where(eq(identities.id, ownerId));
      await db.delete(identities).where(eq(identities.id, superadminId));
    },
  };
}
