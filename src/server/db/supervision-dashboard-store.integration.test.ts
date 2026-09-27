import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "~/server/db";
import {
  apoloSuperadmins,
  clinicInvitationDeliveries,
  clinicInvitations,
  clinics,
  user as identities,
} from "~/server/db/schema";
import { drizzleSupervisionDashboardStore } from "./supervision-dashboard-store";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("panel de supervisión en PostgreSQL con RLS", () => {
  databaseTest(
    "autoriza al superadmin y limita el resumen a datos operativos",
    async () => {
      const suffix = randomUUID();
      const superadminId = `apo-109-superadmin-${suffix}`;
      const otherIdentityId = `apo-109-other-${suffix}`;
      let clinicId: string | null = null;

      try {
        await db.insert(identities).values([
          {
            id: superadminId,
            name: "Superadmin APO-109",
            email: `${superadminId}@example.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: otherIdentityId,
            name: "Identidad APO-109",
            email: `${otherIdentityId}@example.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);
        await db.insert(apoloSuperadmins).values({ identityId: superadminId });
        const [clinic] = await db
          .insert(clinics)
          .values({ isSynthetic: true, name: `Clínica APO-109 ${suffix}` })
          .returning({ id: clinics.id });
        if (!clinic) throw new Error("No se creó la Clínica de prueba");
        clinicId = clinic.id;
        const [invitation] = await db
          .insert(clinicInvitations)
          .values({
            clinicId,
            email: "owner-apo109@example.test",
            expiresAt: new Date(Date.now() + 60_000),
            recipientName: "Médico propietario",
            tokenHash: `apo-109-${suffix}`,
          })
          .returning({ id: clinicInvitations.id });
        if (!invitation) throw new Error("No se creó la invitación de prueba");
        await db.insert(clinicInvitationDeliveries).values({
          actorIdentityId: superadminId,
          clinicId,
          failureReason: "El proveedor de correo no respondió",
          invitationId: invitation.id,
          result: "failed",
        });

        await expect(
          drizzleSupervisionDashboardStore.readClinic({
            actorIdentityId: otherIdentityId,
            clinicId,
          }),
        ).rejects.toThrow("La Identidad no está autorizada");

        await expect(
          drizzleSupervisionDashboardStore.readClinic({
            actorIdentityId: superadminId,
            clinicId,
          }),
        ).resolves.toMatchObject({
          clinic: { id: clinicId, name: `Clínica APO-109 ${suffix}` },
          owner: {
            access: "pending",
            invitationCanRetry: true,
            invitationDelivery: "failed",
            name: "Médico propietario",
          },
        });

        const templateCoverage =
          await drizzleSupervisionDashboardStore.readTemplateCoverage({
            actorIdentityId: superadminId,
          });
        expect(
          templateCoverage.some(
            ({ clinicId: coveredClinicId }) => coveredClinicId === clinicId,
          ),
        ).toBe(false);
        const queues = await drizzleSupervisionDashboardStore.readSystemQueues({
          actorIdentityId: superadminId,
        });
        expect(Object.keys(queues.workers).sort()).toEqual([
          "appointments",
          "inbound",
          "outbound",
          "provisioning",
          "webhooks",
        ]);
      } finally {
        if (clinicId !== null) {
          await db.delete(clinics).where(eq(clinics.id, clinicId));
        }
        await db
          .delete(apoloSuperadmins)
          .where(eq(apoloSuperadmins.identityId, superadminId));
        await db
          .delete(identities)
          .where(inArray(identities.id, [superadminId, otherIdentityId]));
      }
    },
  );
});
