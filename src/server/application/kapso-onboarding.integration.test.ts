import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createSimulatedWhatsAppConnection } from "~/domain/whatsapp-connection";
import { db } from "~/server/db";
import {
  inClinicTransaction,
  inSuperadminTransaction,
} from "~/server/db/clinic-context";
import { drizzleKapsoOnboardingStore } from "~/server/db/kapso-onboarding-store";
import {
  apoloSuperadmins,
  clinicUsers,
  clinics,
  user as identities,
  whatsappConnections,
  whatsappOnboardingAuditEvents,
  whatsappPreflights,
  whatsappSetupLinks,
} from "~/server/db/schema";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("persistencia y RLS del onboarding Kapso", () => {
  databaseTest(
    "aísla el preflight por Clínica, autoriza solo al superadmin para mutar y permite lectura al owner",
    async () => {
      const suffix = randomUUID();
      const superadminIdentityId = `apo-83-superadmin-${suffix}`;
      const primaryOwnerIdentityId = `apo-83-primary-owner-${suffix}`;
      const otherOwnerIdentityId = `apo-83-other-owner-${suffix}`;
      const fixture = await createFixture({
        otherOwnerIdentityId,
        primaryOwnerIdentityId,
        superadminIdentityId,
      });

      try {
        await drizzleKapsoOnboardingStore.save({
          actorIdentityId: superadminIdentityId,
          auditEvents: [
            {
              action: "preflight-executed",
              customerId: "kapso-customer-apo-83",
              reason: "Preflight completado sin bloqueos conocidos.",
              result: "succeeded",
            },
          ],
          clinicId: fixture.primaryClinicId,
          connection: {
            connectionType: "coexistence",
            metadata: { mode: "coexistence" },
            phoneNumberE164: "+50370000000",
            phoneNumberId: "phone-apo-83",
            provider: "kapso",
            status: "pending",
          },
          customerId: "kapso-customer-apo-83",
          preflight: {
            blockers: [],
            checkedAt: new Date("2026-09-06T12:00:00.000Z"),
            checks: {
              metaAuthority: "confirmed",
              numberAssociation: "available",
              numberOwnedByClinic: true,
              ownerConfirmed: true,
              phoneNumberE164: "+50370000000",
              qrDeviceAvailable: true,
              whatsappBusinessApp: "active",
            },
            nextAction: "Generar el Enlace de configuración de WhatsApp",
            reason: null,
            status: "passed",
          },
        });

        await expect(
          drizzleKapsoOnboardingStore.read({
            access: "clinic-owner",
            actorIdentityId: primaryOwnerIdentityId,
            clinicId: fixture.primaryClinicId,
          }),
        ).resolves.toMatchObject({
          customerId: "kapso-customer-apo-83",
          setupLink: null,
        });

        await drizzleKapsoOnboardingStore.save({
          access: "clinic-owner",
          actorIdentityId: primaryOwnerIdentityId,
          auditEvents: [
            {
              action: "setup-link-created",
              customerId: "kapso-customer-apo-83",
              reason: "Enlace creado por el propietario.",
              result: "succeeded",
              setupLinkId: "kapso-link-apo-84",
            },
          ],
          clinicId: fixture.primaryClinicId,
          customerId: "kapso-customer-apo-83",
          setupLink: {
            createdAt: new Date("2026-09-06T12:00:00.000Z"),
            expiresAt: new Date("2026-10-06T12:00:00.000Z"),
            kapsoSetupLinkId: "kapso-link-apo-84",
            providerError: null,
            providerStatus: "pending",
            revokedAt: null,
            status: "active",
            url: "https://app.kapso.ai/setup/opaque-token",
            usedAt: null,
          },
        });

        await expect(
          drizzleKapsoOnboardingStore.read({
            access: "clinic-owner",
            actorIdentityId: primaryOwnerIdentityId,
            clinicId: fixture.primaryClinicId,
          }),
        ).resolves.toMatchObject({
          setupLink: {
            status: "active",
            url: "https://app.kapso.ai/setup/opaque-token",
          },
          setupLinkProviderId: "kapso-link-apo-84",
        });

        await expect(
          inClinicTransaction(
            {
              clinicId: fixture.primaryClinicId,
              identityId: primaryOwnerIdentityId,
            },
            async (transaction) => ({
              audit: await transaction
                .select({
                  clinicId: whatsappOnboardingAuditEvents.clinicId,
                  customerId: whatsappOnboardingAuditEvents.customerId,
                  setupLinkId: whatsappOnboardingAuditEvents.setupLinkId,
                })
                .from(whatsappOnboardingAuditEvents),
              preflight: await transaction
                .select({
                  clinicId: whatsappPreflights.clinicId,
                  customerId: whatsappPreflights.customerId,
                })
                .from(whatsappPreflights),
              setupLink: await transaction
                .select({
                  clinicId: whatsappSetupLinks.clinicId,
                  kapsoSetupLinkId: whatsappSetupLinks.kapsoSetupLinkId,
                })
                .from(whatsappSetupLinks),
            }),
          ),
        ).resolves.toEqual({
          audit: [
            {
              clinicId: fixture.primaryClinicId,
              customerId: "kapso-customer-apo-83",
              setupLinkId: null,
            },
            {
              clinicId: fixture.primaryClinicId,
              customerId: "kapso-customer-apo-83",
              setupLinkId: "kapso-link-apo-84",
            },
          ],
          preflight: [
            {
              clinicId: fixture.primaryClinicId,
              customerId: "kapso-customer-apo-83",
            },
          ],
          setupLink: [
            {
              clinicId: fixture.primaryClinicId,
              kapsoSetupLinkId: "kapso-link-apo-84",
            },
          ],
        });

        await expect(
          inClinicTransaction(
            {
              clinicId: fixture.otherClinicId,
              identityId: otherOwnerIdentityId,
            },
            async (transaction) => ({
              audit: await transaction
                .select({ clinicId: whatsappOnboardingAuditEvents.clinicId })
                .from(whatsappOnboardingAuditEvents),
              preflight: await transaction
                .select({ clinicId: whatsappPreflights.clinicId })
                .from(whatsappPreflights),
              setupLink: await transaction
                .select({ clinicId: whatsappSetupLinks.clinicId })
                .from(whatsappSetupLinks),
            }),
          ),
        ).resolves.toEqual({ audit: [], preflight: [], setupLink: [] });

        const persisted = await inSuperadminTransaction(
          superadminIdentityId,
          async (transaction) => ({
            audit:
              await transaction.query.whatsappOnboardingAuditEvents.findMany({
                where: eq(
                  whatsappOnboardingAuditEvents.clinicId,
                  fixture.primaryClinicId,
                ),
              }),
            preflight: await transaction.query.whatsappPreflights.findFirst({
              where: eq(whatsappPreflights.clinicId, fixture.primaryClinicId),
            }),
          }),
        );
        expect(JSON.stringify(persisted.audit)).not.toMatch(
          /otp|qr|token|secret/i,
        );
        expect(persisted.audit).toHaveLength(2);
        expect(persisted.audit).toContainEqual(
          expect.objectContaining({
            actorIdentityId: superadminIdentityId,
            customerId: "kapso-customer-apo-83",
            result: "succeeded",
            setupLinkId: null,
          }),
        );
        expect(persisted.audit).toContainEqual(
          expect.objectContaining({
            actorIdentityId: primaryOwnerIdentityId,
            action: "setup-link-created",
            result: "succeeded",
            setupLinkId: "kapso-link-apo-84",
          }),
        );
        expect(JSON.stringify(persisted.audit)).not.toContain("opaque-token");
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

async function createFixture(input: {
  otherOwnerIdentityId: string;
  primaryOwnerIdentityId: string;
  superadminIdentityId: string;
}) {
  const identityIds = [
    input.superadminIdentityId,
    input.primaryOwnerIdentityId,
    input.otherOwnerIdentityId,
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
    .values({ identityId: input.superadminIdentityId });

  const createClinic = (ownerIdentityId: string, name: string) =>
    inSuperadminTransaction(input.superadminIdentityId, async (transaction) => {
      const [clinic] = await transaction
        .insert(clinics)
        .values({ isSynthetic: true, name })
        .returning({ id: clinics.id });
      if (clinic === undefined) throw new Error("No se creó la Clínica");
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${clinic.id}, true)`,
      );
      await transaction.execute(
        sql`select set_config('app.subscription_status', 'active', true)`,
      );
      await transaction
        .insert(whatsappConnections)
        .values(createSimulatedWhatsAppConnection(clinic.id));
      await transaction.insert(clinicUsers).values({
        clinicId: clinic.id,
        identityId: ownerIdentityId,
        role: "owner",
      });
      return clinic.id;
    });

  const primaryClinicId = await createClinic(
    input.primaryOwnerIdentityId,
    "Clínica APO-83 primaria",
  );
  const otherClinicId = await createClinic(
    input.otherOwnerIdentityId,
    "Clínica APO-83 otra",
  );

  return {
    otherClinicId,
    primaryClinicId,
    async cleanup() {
      await inSuperadminTransaction(
        input.superadminIdentityId,
        async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${primaryClinicId}, true)`,
          );
          await transaction
            .delete(whatsappOnboardingAuditEvents)
            .where(
              inArray(whatsappOnboardingAuditEvents.clinicId, [
                primaryClinicId,
                otherClinicId,
              ]),
            );
          await transaction
            .delete(clinics)
            .where(inArray(clinics.id, [primaryClinicId, otherClinicId]));
        },
      );
      await db
        .delete(apoloSuperadmins)
        .where(eq(apoloSuperadmins.identityId, input.superadminIdentityId));
      await db.delete(identities).where(inArray(identities.id, identityIds));
    },
  };
}
