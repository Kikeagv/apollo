import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createSimulatedWhatsAppConnection } from "~/domain/whatsapp-connection";
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
  whatsappConnections,
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
    "reproduce el mismo resultado para reintentos concurrentes sin duplicar efectos",
    async () => {
      const fixture = await createFixture();
      const subscriptionSupport = createSubscriptionSupport(
        drizzleSubscriptionSupportStore,
      );

      try {
        const paymentInput = {
          amountUsd: "00035.00",
          clinicId: fixture.clinicId,
          operationKey: `transfer-payment:${fixture.clinicId}:concurrent`,
          recordedByIdentityId: fixture.superadminId,
          reference: "APO-97-CONCURRENT",
        };
        const [firstPayment, repeatedPayment] = await Promise.all([
          subscriptionSupport.recordTransferPayment(paymentInput),
          subscriptionSupport.recordTransferPayment(paymentInput),
        ]);
        expect(repeatedPayment).toEqual(firstPayment);

        const subscriptionInput = {
          changedByIdentityId: fixture.superadminId,
          clinicId: fixture.clinicId,
          operationKey: `subscription-status:${fixture.clinicId}:concurrent`,
          status: "suspended" as const,
        };
        const [firstSubscription, repeatedSubscription] = await Promise.all([
          subscriptionSupport.changeSubscriptionStatus(subscriptionInput),
          subscriptionSupport.changeSubscriptionStatus(subscriptionInput),
        ]);
        expect(repeatedSubscription).toEqual(firstSubscription);

        const supportInput = {
          clinicId: fixture.clinicId,
          expiresAt: new Date(Date.now() + 60_000),
          operationKey: `support-session:${fixture.clinicId}:concurrent`,
          reason: "Revisar una operación administrativa repetida",
          superadminIdentityId: fixture.superadminId,
        };
        const [firstSession, repeatedSession] = await Promise.all([
          subscriptionSupport.openSupportSession(supportInput),
          subscriptionSupport.openSupportSession(supportInput),
        ]);
        expect(repeatedSession).toEqual(firstSession);

        const persisted = await inSuperadminTransaction(
          fixture.superadminId,
          async (transaction) => ({
            audits: await transaction.query.apoloAuditEvents.findMany({
              where: eq(apoloAuditEvents.clinicId, fixture.clinicId),
            }),
            payments: await transaction.query.transferPayments.findMany({
              where: eq(transferPayments.clinicId, fixture.clinicId),
            }),
            sessions: await transaction.query.clinicSupportSessions.findMany({
              where: eq(clinicSupportSessions.clinicId, fixture.clinicId),
            }),
          }),
        );
        expect(
          persisted.payments.filter(
            (payment) => payment.operationKey === paymentInput.operationKey,
          ),
        ).toHaveLength(1);
        expect(persisted.payments[0]?.amountUsd).toBe("35.00");
        expect(
          persisted.sessions.filter(
            (session) => session.operationKey === supportInput.operationKey,
          ),
        ).toHaveLength(1);
        expect(
          persisted.audits.filter(
            (audit) =>
              audit.operationKey === paymentInput.operationKey ||
              audit.operationKey === subscriptionInput.operationKey ||
              audit.operationKey === supportInput.operationKey,
          ),
        ).toHaveLength(3);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "revierte el pago si falla su auditoría y permite reintentar la misma clave",
    async () => {
      const fixture = await createFixture();
      const subscriptionSupport = createSubscriptionSupport(
        drizzleSubscriptionSupportStore,
      );
      const operationKey = `transfer-payment:${fixture.clinicId}:audit-failure`;
      const paymentInput = {
        amountUsd: "18.00",
        clinicId: fixture.clinicId,
        operationKey,
        recordedByIdentityId: fixture.superadminId,
        reference: "APO-97-AUDIT-FAILURE",
      };

      try {
        await expect(
          inSuperadminTransaction(fixture.superadminId, async (transaction) => {
            await transaction.insert(transferPayments).values(paymentInput);
            await transaction.insert(apoloAuditEvents).values({
              action: "transfer-payment-recorded",
              actorIdentityId: `missing-actor-${randomUUID()}`,
              clinicId: fixture.clinicId,
              operationKey,
            });
          }),
        ).rejects.toThrow();

        await expect(
          inSuperadminTransaction(fixture.superadminId, (transaction) =>
            transaction.query.transferPayments.findMany({
              where: eq(transferPayments.operationKey, operationKey),
            }),
          ),
        ).resolves.toEqual([]);

        const result =
          await subscriptionSupport.recordTransferPayment(paymentInput);
        expect(result).toMatchObject({
          operationKey,
          status: "succeeded",
        });

        const persisted = await inSuperadminTransaction(
          fixture.superadminId,
          async (transaction) => ({
            audits: await transaction.query.apoloAuditEvents.findMany({
              where: eq(apoloAuditEvents.operationKey, operationKey),
            }),
            payments: await transaction.query.transferPayments.findMany({
              where: eq(transferPayments.operationKey, operationKey),
            }),
          }),
        );
        expect(persisted.payments).toHaveLength(1);
        expect(persisted.audits).toHaveLength(1);
      } finally {
        await fixture.cleanup();
      }
    },
  );

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
          operationKey: `transfer-payment:${fixture.clinicId}:apo-24`,
          recordedByIdentityId: fixture.superadminId,
          reference: "APO-24-TRX",
        });
        await subscriptionSupport.changeSubscriptionStatus({
          changedByIdentityId: fixture.superadminId,
          clinicId: fixture.clinicId,
          operationKey: `subscription-status:${fixture.clinicId}:suspended`,
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
          operationKey: `subscription-status:${fixture.clinicId}:active`,
          status: "active",
        });
        const supportSession = await subscriptionSupport.openSupportSession({
          clinicId: fixture.clinicId,
          expiresAt: new Date(Date.now() + 60_000),
          operationKey: `support-session:${fixture.clinicId}:incident`,
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
        })
        .returning({ id: clinics.id });
      if (created === undefined) throw new Error("No se creó la Clínica");
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${created.id}, true)`,
      );
      await transaction.execute(
        sql`select set_config('app.subscription_status', 'active', true)`,
      );
      await transaction.insert(whatsappConnections).values({
        ...createSimulatedWhatsAppConnection(created.id),
        phoneNumberE164: whatsappNumberE164,
      });
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
