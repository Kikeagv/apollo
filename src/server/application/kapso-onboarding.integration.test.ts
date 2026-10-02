import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createSimulatedWhatsAppConnection } from "~/domain/whatsapp-connection";
import { kapsoCreatedPhoneNumberConnectionMissingReason } from "~/domain/whatsapp-kapso-provisioning";
import { db } from "~/server/db";
import {
  inClinicTransaction,
  inWhatsAppSetupLinkReturnTransaction,
  inWhatsAppProvisioningWorkerTransaction,
  inSuperadminTransaction,
} from "~/server/db/clinic-context";
import { drizzleKapsoOnboardingStore } from "~/server/db/kapso-onboarding-store";
import { drizzleWhatsAppProvisioningStore } from "~/server/db/whatsapp-provisioning-store";
import {
  apoloSuperadmins,
  clinicUsers,
  clinics,
  user as identities,
  whatsappConnections,
  whatsappOnboardingAuditEvents,
  whatsappPreflights,
  whatsappSetupLinks,
  whatsappWebhookEvents,
} from "~/server/db/schema";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("persistencia y RLS del onboarding Kapso", () => {
  databaseTest(
    "reencola el phone_number.created rechazado cuando el preflight asocia el número a la Clínica",
    async () => {
      const suffix = randomUUID();
      const superadminIdentityId = `apo-83-superadmin-${suffix}`;
      const fixture = await createFixture({
        otherOwnerIdentityId: `apo-83-other-owner-${suffix}`,
        primaryOwnerIdentityId: `apo-83-primary-owner-${suffix}`,
        superadminIdentityId,
      });
      let eventId: string | undefined;

      try {
        const lifecycleEvent = {
          businessAccountId: null,
          customerId: "kapso-customer-retry",
          displayPhoneE164: "+50370000000",
          eventName: "whatsapp.phone_number.created" as const,
          phoneNumberId: "phone-apo-83-retry",
          projectId: "kapso-project-apo-83",
        };
        const queued = await drizzleWhatsAppProvisioningStore.enqueue({
          event: lifecycleEvent,
          idempotencyKey: `kapso-created-${suffix}`,
        });
        eventId = queued.eventId;
        await inSuperadminTransaction(superadminIdentityId, (transaction) =>
          transaction
            .update(whatsappWebhookEvents)
            .set({
              attempts: 1,
              lastError: kapsoCreatedPhoneNumberConnectionMissingReason,
              rejectedAt: new Date("2026-09-06T12:00:00.000Z"),
              status: "rejected",
            })
            .where(eq(whatsappWebhookEvents.id, queued.eventId)),
        );

        const checkedAt = new Date("2026-09-06T12:10:00.000Z");
        await drizzleKapsoOnboardingStore.save({
          actorIdentityId: superadminIdentityId,
          auditEvents: [],
          clinicId: fixture.primaryClinicId,
          connection: {
            connectionType: "coexistence",
            metadata: { mode: "coexistence", source: "kapso-onboarding" },
            phoneNumberE164: "+50370000000",
            phoneNumberId: lifecycleEvent.phoneNumberId,
            provider: "kapso",
            status: "pending",
          },
          customerId: lifecycleEvent.customerId,
          preflight: {
            blockers: [],
            checkedAt,
            checks: {
              metaAuthority: "confirmed",
              numberAssociation: "same-customer",
              numberConnectionType: "coexistence",
              numberOwnedByClinic: true,
              ownerConfirmed: true,
              phoneNumberE164: "+50370000000",
              qrDeviceAvailable: true,
              whatsappBusinessApp: "active",
            },
            nextAction: "Esperar la provisión de WhatsApp",
            reason: null,
            status: "passed",
          },
        });

        await expect(
          inSuperadminTransaction(superadminIdentityId, (transaction) =>
            transaction.query.whatsappWebhookEvents.findFirst({
              columns: {
                attempts: true,
                lastError: true,
                nextAttemptAt: true,
                rejectedAt: true,
                status: true,
              },
              where: eq(whatsappWebhookEvents.id, queued.eventId),
            }),
          ),
        ).resolves.toMatchObject({
          attempts: 0,
          lastError: null,
          nextAttemptAt: checkedAt,
          rejectedAt: null,
          status: "pending",
        });
      } finally {
        if (eventId !== undefined) {
          await inWhatsAppProvisioningWorkerTransaction((transaction) =>
            transaction
              .delete(whatsappWebhookEvents)
              .where(eq(whatsappWebhookEvents.id, eventId!)),
          );
        }
        await fixture.cleanup();
      }
    },
  );

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
              numberConnectionType: "unknown",
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
          drizzleKapsoOnboardingStore.findSetupLinkByProviderId(
            "kapso-link-apo-84",
          ),
        ).resolves.toMatchObject({
          clinicId: fixture.primaryClinicId,
          customerId: "kapso-customer-apo-83",
        });
        await expect(
          drizzleKapsoOnboardingStore.recordSetupLinkReturn({
            errorCode: null,
            returnedAt: new Date("2026-09-06T12:05:00.000Z"),
            setupLinkId: "kapso-link-apo-84",
            status: "success",
          }),
        ).resolves.toBe(true);
        await expect(
          drizzleKapsoOnboardingStore.recordSetupLinkReturn({
            errorCode: null,
            returnedAt: new Date("2026-09-06T12:06:00.000Z"),
            setupLinkId: "kapso-link-apo-84",
            status: "success",
          }),
        ).resolves.toBe(false);
        await drizzleKapsoOnboardingStore.save({
          actorIdentityId: superadminIdentityId,
          auditEvents: [
            {
              action: "setup-link-email-sent",
              customerId: "kapso-customer-apo-83",
              reason:
                "El enlace se envió al correo registrado del propietario.",
              result: "succeeded",
              setupLinkId: "kapso-link-apo-84",
            },
          ],
          clinicId: fixture.primaryClinicId,
          customerId: "kapso-customer-apo-83",
        });
        await expect(
          drizzleKapsoOnboardingStore.read({
            access: "clinic-owner",
            actorIdentityId: primaryOwnerIdentityId,
            clinicId: fixture.primaryClinicId,
          }),
        ).resolves.toMatchObject({
          setupLinkReturn: {
            errorCode: null,
            status: "success",
          },
        });
        await expect(
          drizzleKapsoOnboardingStore.findSetupLinkByProviderId(
            "kapso-link-does-not-exist",
          ),
        ).resolves.toBeUndefined();
        await expect(
          inWhatsAppSetupLinkReturnTransaction(
            "kapso-link-apo-84",
            (transaction) =>
              transaction
                .update(whatsappSetupLinks)
                .set({ status: "revoked" })
                .where(
                  eq(whatsappSetupLinks.kapsoSetupLinkId, "kapso-link-apo-84"),
                ),
          ),
        ).rejects.toThrow();

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
        expect(persisted.audit).toHaveLength(3);
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
        expect(persisted.audit).toContainEqual(
          expect.objectContaining({
            actorIdentityId: superadminIdentityId,
            action: "setup-link-email-sent",
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
