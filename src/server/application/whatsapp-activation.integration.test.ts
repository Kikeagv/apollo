import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "~/server/db";
import {
  inClinicTransaction,
  inSuperadminRlsTransaction,
  inSuperadminTransaction,
  inWhatsAppProvisioningWorkerTransaction,
  inWhatsAppWebhookIngressTransaction,
} from "~/server/db/clinic-context";
import { drizzleWhatsAppActivationEvidenceStore } from "~/server/db/whatsapp-activation-evidence-store";
import { drizzleKapsoOnboardingStore } from "~/server/db/kapso-onboarding-store";
import {
  apoloAuditEvents,
  apoloSuperadmins,
  clinicUsers,
  clinics,
  user as identities,
  whatsappActivationEvidences,
  whatsappProvisioningSteps,
  whatsappWebhookEvents,
} from "~/server/db/schema";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("persistencia y RLS de evidencia de cierre de WhatsApp", () => {
  databaseTest(
    "aísla la evidencia de la sesión clínica y conserva un historial append-only",
    async () => {
      const suffix = randomUUID();
      const superadminIdentityId = `apo-94-superadmin-${suffix}`;
      const ownerIdentityId = `apo-94-owner-${suffix}`;
      const otherOwnerIdentityId = `apo-94-other-owner-${suffix}`;
      const identityIds = [
        superadminIdentityId,
        ownerIdentityId,
        otherOwnerIdentityId,
      ];

      await db.insert(identities).values(
        identityIds.map((id) => ({
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

      const fixture = await inSuperadminTransaction(
        superadminIdentityId,
        async (transaction) => {
          const createdClinics = await transaction
            .insert(clinics)
            .values([
              { isSynthetic: false, name: `APO-94 primaria ${suffix}` },
              { isSynthetic: false, name: `APO-94 secundaria ${suffix}` },
            ])
            .returning({ id: clinics.id });
          const primaryClinicId = createdClinics[0]?.id;
          const otherClinicId = createdClinics[1]?.id;
          if (primaryClinicId === undefined || otherClinicId === undefined) {
            throw new Error("No se crearon las Clínicas de prueba");
          }
          await transaction.insert(clinicUsers).values([
            {
              clinicId: primaryClinicId,
              identityId: ownerIdentityId,
              role: "owner",
            },
            {
              clinicId: otherClinicId,
              identityId: otherOwnerIdentityId,
              role: "owner",
            },
          ]);
          return { otherClinicId, primaryClinicId };
        },
      );
      const provisioningEventId = randomUUID();
      await inWhatsAppWebhookIngressTransaction((transaction) =>
        transaction.insert(whatsappWebhookEvents).values({
          eventName: "whatsapp.phone_number.created",
          id: provisioningEventId,
          idempotencyKey: `apo-94-generation-${suffix}`,
          payload: {},
          receivedAt: new Date(),
          status: "processed",
        }),
      );
      await inWhatsAppProvisioningWorkerTransaction((transaction) =>
        transaction.insert(whatsappProvisioningSteps).values({
          clinicId: fixture.primaryClinicId,
          completedAt: new Date(),
          eventId: provisioningEventId,
          phoneNumberId: `phone-apo-94-${suffix}`,
          status: "succeeded",
          step: "project-webhook",
        }),
      );
      const fixtureWithGeneration = { ...fixture, provisioningEventId };

      try {
        await expect(
          drizzleKapsoOnboardingStore.read({
            access: "superadmin",
            actorIdentityId: superadminIdentityId,
            clinicId: fixtureWithGeneration.primaryClinicId,
          }),
        ).resolves.toMatchObject({
          ownerAccess: "ready",
          ownerName: ownerIdentityId,
        });
        await drizzleWhatsAppActivationEvidenceStore.record({
          actorIdentityId: superadminIdentityId,
          clinicId: fixtureWithGeneration.primaryClinicId,
          criterionCode: "technical-readiness",
          evidenceReference: "kapso-run-94",
          now: new Date("2026-09-16T12:00:00.000Z"),
          pendingReason: null,
          provisioningEventId,
          source: "kapso",
        });
        await drizzleWhatsAppActivationEvidenceStore.record({
          actorIdentityId: superadminIdentityId,
          clinicId: fixtureWithGeneration.primaryClinicId,
          criterionCode: "technical-readiness",
          evidenceReference: "kapso-run-94-updated",
          now: new Date("2026-09-16T12:01:00.000Z"),
          pendingReason: null,
          provisioningEventId,
          source: "kapso",
        });

        await expect(
          drizzleWhatsAppActivationEvidenceStore.read({
            actorIdentityId: superadminIdentityId,
            clinicId: fixtureWithGeneration.primaryClinicId,
          }),
        ).resolves.toMatchObject([
          {
            criterionCode: "technical-readiness",
            evidenceReference: "kapso-run-94-updated",
            source: "kapso",
          },
        ]);
        await expect(
          inSuperadminRlsTransaction(superadminIdentityId, (transaction) =>
            transaction
              .select()
              .from(whatsappActivationEvidences)
              .where(
                eq(
                  whatsappActivationEvidences.clinicId,
                  fixtureWithGeneration.primaryClinicId,
                ),
              ),
          ),
        ).resolves.toHaveLength(2);

        await expect(
          inSuperadminRlsTransaction(superadminIdentityId, (transaction) =>
            transaction
              .update(whatsappActivationEvidences)
              .set({ evidenceReference: "mutation-must-be-denied" })
              .where(
                eq(
                  whatsappActivationEvidences.clinicId,
                  fixtureWithGeneration.primaryClinicId,
                ),
              ),
          ),
        ).rejects.toThrow();
        await expect(
          inSuperadminRlsTransaction(superadminIdentityId, (transaction) =>
            transaction
              .delete(whatsappActivationEvidences)
              .where(
                eq(
                  whatsappActivationEvidences.clinicId,
                  fixtureWithGeneration.primaryClinicId,
                ),
              ),
          ),
        ).rejects.toThrow();
        await expect(
          drizzleWhatsAppActivationEvidenceStore.read({
            actorIdentityId: superadminIdentityId,
            clinicId: fixtureWithGeneration.primaryClinicId,
          }),
        ).resolves.toMatchObject([
          {
            evidenceReference: "kapso-run-94-updated",
            source: "kapso",
          },
        ]);

        await expect(
          inClinicTransaction(
            {
              clinicId: fixtureWithGeneration.primaryClinicId,
              identityId: ownerIdentityId,
            },
            async (transaction) =>
              transaction.select().from(whatsappActivationEvidences),
          ),
        ).resolves.toEqual([]);
        await expect(
          drizzleWhatsAppActivationEvidenceStore.record({
            actorIdentityId: ownerIdentityId,
            clinicId: fixtureWithGeneration.primaryClinicId,
            criterionCode: "technical-readiness",
            evidenceReference: "owner-must-not-write",
            now: new Date(),
            pendingReason: null,
            provisioningEventId,
            source: "kapso",
          }),
        ).rejects.toThrow("no está autorizada");
        await expect(
          drizzleWhatsAppActivationEvidenceStore.record({
            actorIdentityId: superadminIdentityId,
            clinicId: fixtureWithGeneration.otherClinicId,
            criterionCode: "technical-readiness",
            evidenceReference: "other-clinic-must-not-reuse-generation",
            now: new Date("2026-09-16T12:02:00.000Z"),
            pendingReason: null,
            provisioningEventId,
            source: "kapso",
          }),
        ).rejects.toThrow("no pertenece a la Clínica");
      } finally {
        await inSuperadminTransaction(
          superadminIdentityId,
          async (transaction) => {
            await transaction
              .delete(apoloAuditEvents)
              .where(
                inArray(apoloAuditEvents.clinicId, [
                  fixtureWithGeneration.primaryClinicId,
                  fixtureWithGeneration.otherClinicId,
                ]),
              );
            await transaction
              .delete(clinicUsers)
              .where(
                and(
                  inArray(clinicUsers.clinicId, [
                    fixtureWithGeneration.primaryClinicId,
                    fixtureWithGeneration.otherClinicId,
                  ]),
                  inArray(clinicUsers.identityId, [
                    ownerIdentityId,
                    otherOwnerIdentityId,
                  ]),
                ),
              );
            await transaction
              .delete(clinics)
              .where(
                inArray(clinics.id, [
                  fixtureWithGeneration.primaryClinicId,
                  fixtureWithGeneration.otherClinicId,
                ]),
              );
          },
        );
        await db
          .delete(whatsappWebhookEvents)
          .where(eq(whatsappWebhookEvents.id, provisioningEventId));
        await db
          .delete(apoloSuperadmins)
          .where(eq(apoloSuperadmins.identityId, superadminIdentityId));
        await db.delete(identities).where(inArray(identities.id, identityIds));
      }
    },
  );
});
