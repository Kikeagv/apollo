import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createSyntheticClinic,
  type SyntheticClinicRegistration,
} from "./create-synthetic-clinic";
import { db } from "../db";
import { inSuperadminTransaction } from "../db/clinic-context";
import {
  apoloSuperadmins,
  clinics,
  clinicInvitations,
  identityAuditEvents,
  user as identities,
} from "../db/schema";
import { drizzleSyntheticClinicRegistration } from "../db/synthetic-clinic-registration";
import {
  getSentClinicOwnerInvitations,
  sendSimulatedClinicOwnerInvitation,
} from "../email/simulated-identity-email";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("alta controlada persistente de Clínica sintética", () => {
  databaseTest("persiste el alta autorizada, la invitación y su auditoría mediante RLS", async () => {
    const identityId = `apo-27-superadmin-${randomUUID()}`;
    const email = `${identityId}@example.test`;
    let clinicId: string | undefined;
    const initialInvitationCount = getSentClinicOwnerInvitations().length;
    const registry: SyntheticClinicRegistration = {
      async register(input) {
        const registration = await drizzleSyntheticClinicRegistration.register(
          input,
        );
        clinicId = registration.clinic.id;
        return registration;
      },
      recordInvitationDelivery(input) {
        return drizzleSyntheticClinicRegistration.recordInvitationDelivery(
          input,
        );
      },
    };

    try {
      await db.insert(identities).values({
        id: identityId,
        name: "Superadmin de prueba APO-27",
        email,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await db.insert(apoloSuperadmins).values({ identityId });

      const clinic = await createSyntheticClinic(
        {
          actorIdentityId: identityId,
          clinicName: "Clínica Aurora de prueba",
          owner: {
            email: "ana.aurora@example.test",
            name: "Dra. Ana Reyes",
          },
        },
        {
          registry,
          sendOwnerInvitation: sendSimulatedClinicOwnerInvitation,
        },
      );

      const persisted = await inSuperadminTransaction(
        identityId,
        async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${clinic.id}, true)`,
          );
          const invitation = await transaction.query.clinicInvitations.findFirst(
            {
              where: eq(clinicInvitations.clinicId, clinic.id),
            },
          );
          const auditEvents = await transaction.query.identityAuditEvents.findMany(
            {
              where: eq(identityAuditEvents.clinicId, clinic.id),
            },
          );
          return { invitation, auditEvents };
        },
      );

      expect(clinic).toMatchObject({
        isSynthetic: true,
        name: "Clínica Aurora de prueba",
      });
      expect(persisted.invitation).toMatchObject({
        email: "ana.aurora@example.test",
        ownerName: "Dra. Ana Reyes",
      });
      expect(persisted.invitation?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(persisted.auditEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "synthetic-clinic-created",
            actorIdentityId: identityId,
            result: "succeeded",
          }),
          expect.objectContaining({
            action: "clinic-owner-invited",
            actorIdentityId: identityId,
            result: "succeeded",
          }),
        ]),
      );
      expect(getSentClinicOwnerInvitations()).toHaveLength(
        initialInvitationCount + 1,
      );
    } finally {
      if (clinicId !== undefined) {
        const clinicIdToClean = clinicId;
        await inSuperadminTransaction(identityId, async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${clinicIdToClean}, true)`,
          );
          await transaction
            .delete(identityAuditEvents)
            .where(eq(identityAuditEvents.clinicId, clinicIdToClean));
          await transaction
            .delete(clinics)
            .where(eq(clinics.id, clinicIdToClean));
        });
      }
      await db
        .delete(apoloSuperadmins)
        .where(eq(apoloSuperadmins.identityId, identityId));
      await db.delete(identities).where(eq(identities.id, identityId));
    }
  });
});
