import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createSimulatedWhatsAppConnection } from "~/domain/whatsapp-connection";
import {
  buildWhatsAppConsentPolicy,
  WHATSAPP_CONSENT_TEXTUAL_RESPONSE,
} from "~/domain/whatsapp-consent";
import { WHATSAPP_BILLING_RESERVATION_LEASE_MS } from "./whatsapp-billing-capacity";
import { drizzleWhatsAppBillingCapacityStore } from "../db/whatsapp-billing-capacity-store";
import { drizzleTransactionalDeliveryStore } from "../db/transactional-delivery-store";
import { reactivateWhatsAppCircuitBreaker } from "./whatsapp-circuit-breaker";
import { db } from "../db";
import {
  inSuperadminTransaction,
  inWhatsAppOutboundWorkerTransaction,
  inWhatsAppProvisioningWorkerTransaction,
} from "../db/clinic-context";
import {
  drizzleWhatsAppCircuitBreakerStore,
  purgeExpiredWhatsAppOperationalData,
} from "../db/whatsapp-circuit-breaker-store";
import {
  apoloSuperadmins,
  appointments,
  clinicUsers,
  clinics,
  contactPatientLinks,
  contacts,
  doctors,
  patients,
  transactionalDeliveries,
  user as identities,
  whatsappBilling,
  whatsappBillingReservations,
  whatsappCircuitBreakerAlerts,
  whatsappCircuitBreakerAudits,
  whatsappCircuitBreakers,
  whatsappConnections,
  whatsappContactConsents,
  whatsappIdentities,
  whatsappReadiness,
  whatsappSmokeRuns,
} from "../db/schema";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("circuit breaker de WhatsApp persistente", () => {
  databaseTest(
    "aísla Clínicas, serializa fallos y reanuda la outbox con evidencia E2E",
    async () => {
      const fixture = await createFixture();
      const initial = new Date();

      try {
        const failures = await Promise.all(
          [0, 1, 2].map((offset) =>
            drizzleWhatsAppCircuitBreakerStore.recordFailure({
              cause: "provider-error",
              clinicId: fixture.primaryClinicId,
              now: new Date(initial.valueOf() + offset * 1_000),
              reason: "Kapso respondió 503",
              workerKind: "outbound",
            }),
          ),
        );

        expect(failures.filter((failure) => failure.opened)).toHaveLength(1);
        await expect(
          drizzleWhatsAppCircuitBreakerStore.read({
            access: "superadmin",
            actorIdentityId: fixture.superadminIdentityId,
            clinicId: fixture.primaryClinicId,
          }),
        ).resolves.toMatchObject({
          cause: "provider-error",
          failureCount: 3,
          openedBy: {
            actorIdentityId: null,
            actorKind: "worker",
            displayName: null,
          },
          status: "open",
        });
        await expect(
          drizzleWhatsAppCircuitBreakerStore.read({
            access: "superadmin",
            actorIdentityId: fixture.superadminIdentityId,
            clinicId: fixture.otherClinicId,
          }),
        ).resolves.toMatchObject({ status: "closed" });
        const claimsWhilePrimaryCircuitIsOpen =
          await drizzleTransactionalDeliveryStore.claimReadyDeliveries({
            now: new Date(initial.valueOf() + 3_000),
          });
        const claimsWhileOpenIds = claimsWhilePrimaryCircuitIsOpen.map(
          ({ id }) => id,
        );
        expect(claimsWhileOpenIds).toContain(fixture.otherDeliveryId);
        expect(claimsWhileOpenIds).not.toContain(fixture.primaryDeliveryId);

        await expect(
          inSuperadminTransaction(
            fixture.superadminIdentityId,
            async (transaction) => {
              await transaction.execute(
                sql`select set_config('app.clinic_id', ${fixture.primaryClinicId}, true)`,
              );
              return transaction
                .select({
                  clinicId: whatsappConnections.clinicId,
                  status: whatsappConnections.status,
                })
                .from(whatsappConnections)
                .where(
                  inArray(whatsappConnections.clinicId, [
                    fixture.primaryClinicId,
                    fixture.otherClinicId,
                  ]),
                );
            },
          ),
        ).resolves.toEqual(
          expect.arrayContaining([
            { clinicId: fixture.primaryClinicId, status: "blocked" },
            { clinicId: fixture.otherClinicId, status: "ready" },
          ]),
        );
        await expect(
          inSuperadminTransaction(
            fixture.superadminIdentityId,
            async (transaction) => {
              await transaction.execute(
                sql`select set_config('app.clinic_id', ${fixture.primaryClinicId}, true)`,
              );
              return transaction
                .select({
                  cause: whatsappCircuitBreakerAlerts.cause,
                  status: whatsappCircuitBreakerAlerts.status,
                })
                .from(whatsappCircuitBreakerAlerts)
                .where(
                  eq(
                    whatsappCircuitBreakerAlerts.clinicId,
                    fixture.primaryClinicId,
                  ),
                );
            },
          ),
        ).resolves.toEqual([{ cause: "provider-error", status: "open" }]);

        await drizzleWhatsAppCircuitBreakerStore.recordMetric({
          clinicId: fixture.primaryClinicId,
          idempotencyKey: "delivery-1",
          latencyMs: 100,
          metric: { category: "message", direction: "outbound" },
          occurredAt: initial,
          operation: "transactional-delivery",
          outcome: "accepted",
          metaChargesCents: 5,
          platformChargesCents: 2,
          workerKind: "outbound",
        });
        await drizzleWhatsAppCircuitBreakerStore.recordMetric({
          clinicId: fixture.primaryClinicId,
          idempotencyKey: "delivery-1",
          latencyMs: 999,
          metric: { category: "message", direction: "outbound" },
          occurredAt: initial,
          operation: "transactional-delivery",
          outcome: "failed",
          metaChargesCents: 999,
          platformChargesCents: 999,
          workerKind: "outbound",
        });
        await drizzleWhatsAppCircuitBreakerStore.recordMetric({
          clinicId: fixture.primaryClinicId,
          idempotencyKey: "inbound-1",
          latencyMs: 50,
          metric: { category: "media", direction: "inbound" },
          occurredAt: new Date(initial.valueOf() + 1_000),
          operation: "inbound-message",
          outcome: "accepted",
          workerKind: "inbound",
        });
        await drizzleWhatsAppCircuitBreakerStore.recordMetric({
          clinicId: fixture.primaryClinicId,
          idempotencyKey: "template-1",
          latencyMs: 150,
          metric: { category: "template", direction: "outbound" },
          occurredAt: new Date(initial.valueOf() + 2_000),
          operation: "transactional-delivery",
          outcome: "failed",
          templateName: "appointment_reminder",
          workerKind: "outbound",
        });
        await drizzleWhatsAppCircuitBreakerStore.recordMetric({
          clinicId: fixture.primaryClinicId,
          idempotencyKey: "read-1",
          latencyMs: 200,
          metric: { category: "read-receipt", direction: "outbound" },
          occurredAt: new Date(initial.valueOf() + 3_000),
          operation: "delivery-status",
          outcome: "read",
          workerKind: "outbound",
        });

        await expect(
          drizzleWhatsAppCircuitBreakerStore.readMetrics({
            actorIdentityId: fixture.superadminIdentityId,
            clinicId: fixture.primaryClinicId,
            from: initial,
          }),
        ).resolves.toMatchObject({
          averageLatencyMs: 125,
          errors: 1,
          inboundMessages: 1,
          mediaMessages: 1,
          metaChargesCents: 5,
          outboundMessages: 2,
          platformChargesCents: 2,
          quotaMessages: 3,
          readReceipts: 1,
          templateMessages: 1,
          deliveries: {
            accepted: 1,
            attempted: 2,
            delivered: 0,
            failed: 1,
            unknown: 0,
          },
          templates: [
            { attempted: 1, failed: 1, name: "appointment_reminder" },
          ],
        });

        const currentConnectionEvidence = await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.primaryClinicId}, true)`,
            );
            const [connection] = await transaction
              .select({ updatedAt: whatsappConnections.updatedAt })
              .from(whatsappConnections)
              .where(eq(whatsappConnections.clinicId, fixture.primaryClinicId));
            const [readiness] = await transaction
              .select({ revision: whatsappReadiness.revision })
              .from(whatsappReadiness)
              .where(eq(whatsappReadiness.clinicId, fixture.primaryClinicId));
            if (connection === undefined || readiness === undefined) {
              throw new Error("La evidencia de la Conexión no está disponible");
            }
            return {
              ...fixture.primaryConnectionEvidence,
              connectionUpdatedAt: connection.updatedAt,
              readinessRevision: readiness.revision,
            };
          },
        );
        const reactivated = await reactivateWhatsAppCircuitBreaker(
          {
            actorIdentityId: fixture.superadminIdentityId,
            causeFixed: true,
            clinicId: fixture.primaryClinicId,
            connectionProvider: "simulated",
            e2eEvidence: {
              controlledTestContact: false,
              evidence: "Roundtrip sintético del proveedor simulado",
              finishedAt: fixture.smokeFinishedAt,
              id: fixture.smokeRunId,
              provisioningEventId: null,
              providerTransportVerified: false,
              realPatientsEnabled: false,
              requireRealRoundtrip: false,
              startedAt: fixture.smokeStartedAt,
              status: "passed",
              syntheticContact: true,
              steps: [],
            },
            manualConfirmation: true,
            now: new Date(),
            phoneNumberId: currentConnectionEvidence.phoneNumberId,
            projectWebhookId: currentConnectionEvidence.projectWebhookId,
            connectionEvidence: currentConnectionEvidence,
          },
          {
            store: drizzleWhatsAppCircuitBreakerStore,
          },
        );
        expect(reactivated).toMatchObject({
          lastSyntheticTestStatus: "passed",
          status: "closed",
        });
        const resumedDeliveries =
          await drizzleTransactionalDeliveryStore.claimReadyDeliveries({
            now: new Date(),
          });
        expect(resumedDeliveries.map(({ id }) => id)).toEqual([
          fixture.primaryDeliveryId,
        ]);
        await expect(
          drizzleTransactionalDeliveryStore.claimReadyDeliveries({
            now: new Date(),
          }),
        ).resolves.toEqual([]);

        const persisted = await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.primaryClinicId}, true)`,
            );
            const [connection] = await transaction
              .select({ status: whatsappConnections.status })
              .from(whatsappConnections)
              .where(eq(whatsappConnections.clinicId, fixture.primaryClinicId));
            const audits = await transaction
              .select({ action: whatsappCircuitBreakerAudits.action })
              .from(whatsappCircuitBreakerAudits)
              .where(
                eq(
                  whatsappCircuitBreakerAudits.clinicId,
                  fixture.primaryClinicId,
                ),
              );
            return { audits, connection };
          },
        );
        expect(persisted.connection?.status).toBe("ready");
        expect(persisted.audits.map(({ action }) => action)).toEqual(
          expect.arrayContaining([
            "failure-recorded",
            "opened",
            "synthetic-test",
            "reactivated",
          ]),
        );
        await expect(
          inSuperadminTransaction(
            fixture.superadminIdentityId,
            async (transaction) => {
              await transaction.execute(
                sql`select set_config('app.clinic_id', ${fixture.primaryClinicId}, true)`,
              );
              return transaction
                .select({ status: whatsappCircuitBreakerAlerts.status })
                .from(whatsappCircuitBreakerAlerts)
                .where(
                  eq(
                    whatsappCircuitBreakerAlerts.clinicId,
                    fixture.primaryClinicId,
                  ),
                );
            },
          ),
        ).resolves.toEqual([{ status: "resolved" }]);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "reserva crédito y cuota de forma idempotente antes de cruzar Kapso",
    async () => {
      const fixture = await createFixture();
      const initial = new Date("2026-09-12T13:00:00.000Z");

      try {
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction.insert(whatsappBilling).values({
              clinicId: fixture.primaryClinicId,
              creditCents: 10,
              creditLimitCents: 10,
              creditReserveCents: 2,
              kapsoMonthlyQuota: 1,
              mode: "partner_managed",
              status: "ready",
            });
          },
        );

        try {
          await inWhatsAppOutboundWorkerTransaction(async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.primaryClinicId}, true)`,
            );
            await transaction.execute(
              sql`select set_config('app.subscription_status', 'active', true)`,
            );
            await transaction
              .update(whatsappBilling)
              .set({ metaChargesCents: 99 })
              .where(eq(whatsappBilling.clinicId, fixture.primaryClinicId));
          });
          throw new Error("El worker outbound pudo alterar cargos Meta");
        } catch (error) {
          const cause = (error as Error & { cause?: Error }).cause;
          expect(`${(error as Error).message} ${cause?.message ?? ""}`).toMatch(
            /sólo puede liquidar capacidad/i,
          );
        }

        try {
          await inWhatsAppProvisioningWorkerTransaction(async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.primaryClinicId}, true)`,
            );
            await transaction.execute(
              sql`select set_config('app.subscription_status', 'active', true)`,
            );
            await transaction
              .update(whatsappConnections)
              .set({ status: "ready" })
              .where(eq(whatsappConnections.clinicId, fixture.primaryClinicId));
          });
          throw new Error("El worker provisioning pudo reactivar la conexión");
        } catch (error) {
          const cause = (error as Error & { cause?: Error }).cause;
          expect(`${(error as Error).message} ${cause?.message ?? ""}`).toMatch(
            /row-level security|violates/i,
          );
        }

        const reservations = await Promise.all(
          [0, 1].map(() =>
            drizzleWhatsAppBillingCapacityStore.reserve({
              clinicId: fixture.primaryClinicId,
              now: initial,
              reservationKey: "apo-91-idempotent-send",
            }),
          ),
        );
        expect(reservations).toEqual(
          expect.arrayContaining([
            { reserved: true, status: "reserved" },
            { reserved: true, status: "already-reserved" },
          ]),
        );

        const readBilling = () =>
          inSuperadminTransaction(
            fixture.superadminIdentityId,
            async (transaction) => {
              const [billing] = await transaction
                .select({
                  consumedCents: whatsappBilling.consumedCents,
                  creditCents: whatsappBilling.creditCents,
                  creditInFlightCents: whatsappBilling.creditInFlightCents,
                  kapsoQuotaConsumed: whatsappBilling.kapsoQuotaConsumed,
                  kapsoQuotaInFlight: whatsappBilling.kapsoQuotaInFlight,
                  metaChargesCents: whatsappBilling.metaChargesCents,
                })
                .from(whatsappBilling)
                .where(eq(whatsappBilling.clinicId, fixture.primaryClinicId));
              return billing;
            },
          );

        await expect(readBilling()).resolves.toMatchObject({
          creditCents: 10,
          creditInFlightCents: 1,
          kapsoQuotaConsumed: 0,
          kapsoQuotaInFlight: 1,
        });

        await drizzleWhatsAppBillingCapacityStore.settle({
          clinicId: fixture.primaryClinicId,
          now: new Date(initial.valueOf() + 1_000),
          outcome: "failed",
          reservationKey: "apo-91-idempotent-send",
        });
        await expect(readBilling()).resolves.toMatchObject({
          creditInFlightCents: 0,
          kapsoQuotaConsumed: 0,
          kapsoQuotaInFlight: 0,
        });

        await expect(
          drizzleWhatsAppBillingCapacityStore.reserve({
            clinicId: fixture.primaryClinicId,
            now: initial,
            reservationKey: "apo-91-expired-reservation",
          }),
        ).resolves.toEqual({ reserved: true, status: "reserved" });
        const reconciliationNow = new Date(
          initial.valueOf() + WHATSAPP_BILLING_RESERVATION_LEASE_MS + 1_000,
        );
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.primaryClinicId}, true)`,
            );
            await transaction
              .update(whatsappBillingReservations)
              .set({
                reservedAt: new Date(
                  initial.valueOf() - WHATSAPP_BILLING_RESERVATION_LEASE_MS,
                ),
                retainUntil: new Date(reconciliationNow.valueOf() - 1_000),
              })
              .where(
                eq(
                  whatsappBillingReservations.reservationKey,
                  "apo-91-expired-reservation",
                ),
              );
          },
        );
        await expect(
          purgeExpiredWhatsAppOperationalData({ now: reconciliationNow }),
        ).resolves.toMatchObject({
          purgedWhatsAppReservations: 1,
          releasedWhatsAppReservations: 1,
        });
        await expect(readBilling()).resolves.toMatchObject({
          creditInFlightCents: 0,
          kapsoQuotaInFlight: 0,
        });

        await expect(
          drizzleWhatsAppBillingCapacityStore.reserve({
            clinicId: fixture.primaryClinicId,
            now: new Date(initial.valueOf() + 2_000),
            reservationKey: "apo-91-idempotent-send",
          }),
        ).resolves.toEqual({ reserved: true, status: "reserved" });
        await drizzleWhatsAppBillingCapacityStore.settle({
          clinicId: fixture.primaryClinicId,
          now: new Date(initial.valueOf() + 3_000),
          outcome: "accepted",
          reservationKey: "apo-91-idempotent-send",
        });
        await expect(readBilling()).resolves.toMatchObject({
          consumedCents: 1,
          creditCents: 9,
          creditInFlightCents: 0,
          metaChargesCents: null,
          kapsoQuotaConsumed: 1,
          kapsoQuotaInFlight: 0,
        });
        await expect(
          drizzleWhatsAppBillingCapacityStore.reserve({
            clinicId: fixture.primaryClinicId,
            now: new Date(initial.valueOf() + 4_000),
            reservationKey: "apo-91-idempotent-send",
          }),
        ).resolves.toEqual({ reserved: true, status: "already-settled" });
        await expect(readBilling()).resolves.toMatchObject({
          creditInFlightCents: 0,
          kapsoQuotaConsumed: 1,
          kapsoQuotaInFlight: 0,
        });

        await expect(
          drizzleWhatsAppBillingCapacityStore.reserve({
            clinicId: fixture.primaryClinicId,
            now: new Date(initial.valueOf() + 5_000),
            reservationKey: "apo-91-quota-exhausted",
          }),
        ).resolves.toEqual({
          reason: "quota-exhausted",
          reserved: false,
        });
        await expect(
          drizzleWhatsAppCircuitBreakerStore.read({
            access: "superadmin",
            actorIdentityId: fixture.superadminIdentityId,
            clinicId: fixture.primaryClinicId,
          }),
        ).resolves.toMatchObject({
          cause: "quota-exhausted",
          status: "open",
        });
        try {
          await inWhatsAppOutboundWorkerTransaction(async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.primaryClinicId}, true)`,
            );
            await transaction.execute(
              sql`select set_config('app.subscription_status', 'active', true)`,
            );
            await transaction
              .update(whatsappCircuitBreakers)
              .set({ cause: null, status: "closed" })
              .where(
                eq(whatsappCircuitBreakers.clinicId, fixture.primaryClinicId),
              );
          });
          throw new Error("El worker outbound pudo cerrar el circuito");
        } catch (error) {
          const cause = (error as Error & { cause?: Error }).cause;
          expect(`${(error as Error).message} ${cause?.message ?? ""}`).toMatch(
            /sólo un superadmin puede cerrar/i,
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
  const superadminIdentityId = `apo-91-superadmin-${suffix}`;
  const primaryOwnerIdentityId = `apo-91-primary-${suffix}`;
  const otherOwnerIdentityId = `apo-91-other-${suffix}`;

  await db.insert(identities).values(
    [superadminIdentityId, primaryOwnerIdentityId, otherOwnerIdentityId].map(
      (id) => ({
        createdAt: new Date(),
        email: `${id}@example.test`,
        emailVerified: true,
        id,
        name: id,
        updatedAt: new Date(),
      }),
    ),
  );
  await db
    .insert(apoloSuperadmins)
    .values({ identityId: superadminIdentityId });

  const createClinic = (ownerIdentityId: string, name: string) =>
    inSuperadminTransaction(superadminIdentityId, async (transaction) => {
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
      const connectionNow = new Date();
      const provisioningEventId = null;
      const phoneNumberId = `phone-${clinic.id}`;
      const projectId = `project-${clinic.id}`;
      const projectWebhookId = `project-webhook-${clinic.id}`;
      const phoneNumberWebhookId = `phone-webhook-${clinic.id}`;
      await transaction.insert(whatsappConnections).values({
        ...createSimulatedWhatsAppConnection(clinic.id, connectionNow),
        businessAccountId: `business-account-${clinic.id}`,
        connectionType: "simulated",
        customer: `simulated:${clinic.id}`,
        metadata: {
          billingStatus: "ready",
          businessAccountId: `business-account-${clinic.id}`,
          mode: "partner_managed",
          nextAction: "Conexión lista",
          projectId,
          provisioningEventId,
          source: "simulated",
          statusReason: "Fixture de integración listo",
          templatesStatus: "ready",
          webhookStatus: "ready",
        },
        phoneNumberId,
        provider: "simulated",
        status: "ready",
        updatedAt: connectionNow,
      });
      await transaction.insert(whatsappReadiness).values({
        billingSyncLastSyncedAt: connectionNow,
        billingSyncStatus: "ready",
        businessAccountId: `business-account-${clinic.id}`,
        clinicId: clinic.id,
        e2eEvidence: "Fixture de roundtrip sintético",
        e2eEvidenceScope: "message-roundtrip",
        e2eLastTestAt: connectionNow,
        e2eStatus: "passed",
        nextAction: "Conexión lista",
        numberEnvironment: "production",
        numberHealth: "healthy",
        numberHealthCheckedAt: connectionNow,
        phoneNumberId,
        phoneNumberWebhookId,
        phoneNumberWebhookLastAttemptAt: connectionNow,
        phoneNumberWebhookStatus: "ready",
        projectId,
        projectWebhookId,
        projectWebhookLastAttemptAt: connectionNow,
        projectWebhookStatus: "ready",
        provisioningEventId,
        revision: 0,
        statusReason: "Fixture de integración listo",
        technicalStatus: "ready",
        templatesSyncLastSyncedAt: connectionNow,
        templatesSyncStatus: "ready",
        updatedAt: connectionNow,
      });
      const smokeRunId = randomUUID();
      await transaction.insert(whatsappSmokeRuns).values({
        actorIdentityId: superadminIdentityId,
        clinicId: clinic.id,
        evidence: "Roundtrip sintético de integración",
        finishedAt: connectionNow,
        id: smokeRunId,
        provisioningEventId: null,
        providerTransportVerified: false,
        realPatientsEnabled: false,
        requiresRealRoundtrip: false,
        startedAt: connectionNow,
        status: "passed",
        steps: [],
        syntheticContact: true,
      });
      const [clinicUser] = await transaction
        .insert(clinicUsers)
        .values({
          clinicId: clinic.id,
          identityId: ownerIdentityId,
          role: "owner",
        })
        .returning({ id: clinicUsers.id });
      if (clinicUser === undefined) {
        throw new Error("No se creó el Usuario de Clínica");
      }
      const [doctor] = await transaction
        .insert(doctors)
        .values({ clinicId: clinic.id, clinicUserId: clinicUser.id })
        .returning({ id: doctors.id });
      const [patient] = await transaction
        .insert(patients)
        .values({
          birthDate: "1980-01-01",
          clinicId: clinic.id,
          name: "Paciente sintético",
        })
        .returning({ id: patients.id });
      const [contact] = await transaction
        .insert(contacts)
        .values({
          clinicId: clinic.id,
          name: "Contacto sintético",
          phoneE164: "+50370000001",
        })
        .returning({ id: contacts.id });
      if (
        doctor === undefined ||
        patient === undefined ||
        contact === undefined
      ) {
        throw new Error("Faltan registros para la Entrega sintética");
      }
      const [whatsappIdentity] = await transaction
        .insert(whatsappIdentities)
        .values({
          clinicId: clinic.id,
          contactId: contact.id,
          phoneE164: "+50370000001",
          phoneNumberId,
          status: "active",
        })
        .returning({ id: whatsappIdentities.id });
      if (whatsappIdentity === undefined) {
        throw new Error("No se creó la Identidad de WhatsApp sintética");
      }
      await transaction.insert(contactPatientLinks).values({
        clinicId: clinic.id,
        contactId: contact.id,
        patientId: patient.id,
        relationship: "contact",
      });
      const terms = await transaction.query.clinicTermsContract.findFirst({
        columns: { currentVersion: true },
        where: (table, operators) => operators.eq(table.id, true),
      });
      if (terms === undefined) throw new Error("Faltan Términos de Clínica");
      const consentPolicy = buildWhatsAppConsentPolicy(terms.currentVersion);
      await transaction.insert(whatsappContactConsents).values({
        acceptedAt: connectionNow,
        acceptedRole: "contact",
        clinicId: clinic.id,
        contactId: contact.id,
        declaration: WHATSAPP_CONSENT_TEXTUAL_RESPONSE,
        identityId: whatsappIdentity.id,
        interactionId: `apo-107-contact-${clinic.id}`,
        patientId: null,
        phoneE164: "+50370000001",
        privacyVersion: consentPolicy.privacyVersion,
        provider: "kapso",
        scope: "contact",
        status: "accepted",
        termsVersion: consentPolicy.termsVersion,
        textReference: consentPolicy.immutableTextReference,
      });
      const [appointment] = await transaction
        .insert(appointments)
        .values({
          clinicId: clinic.id,
          doctorId: doctor.id,
          endsAt: new Date(connectionNow.valueOf() + 86_400_000 + 30 * 60_000),
          patientId: patient.id,
          startsAt: new Date(connectionNow.valueOf() + 86_400_000),
        })
        .returning({ id: appointments.id });
      if (appointment === undefined) {
        throw new Error("No se creó la Cita de la Entrega sintética");
      }
      const [delivery] = await transaction
        .insert(transactionalDeliveries)
        .values({
          appointmentId: appointment.id,
          clinicId: clinic.id,
          idempotencyKey: `apo-107-delivery-${clinic.id}`,
          kind: "appointment-reminder",
          nextAttemptAt: connectionNow,
          payload: {
            appointmentId: appointment.id,
            checkpoint: "24h",
            recipient: {
              id: contact.id,
              name: "Contacto sintético",
              phoneE164: "+50370000001",
            },
          },
          recipientContactId: contact.id,
          retainUntil: new Date(
            connectionNow.valueOf() + 365 * 24 * 60 * 60_000,
          ),
        })
        .returning({ id: transactionalDeliveries.id });
      if (delivery === undefined) {
        throw new Error("No se creó la Entrega sintética");
      }
      return {
        clinicId: clinic.id,
        deliveryId: delivery.id,
        smokeRunId,
        smokeFinishedAt: connectionNow,
        smokeStartedAt: connectionNow,
        connectionEvidence: {
          connectionUpdatedAt: connectionNow,
          phoneNumberId,
          projectWebhookId,
          provisioningEventId,
          readinessRevision: 0,
        },
      };
    });

  const primary = await createClinic(
    primaryOwnerIdentityId,
    "Clínica APO-91 primaria",
  );
  const other = await createClinic(otherOwnerIdentityId, "Clínica APO-91 otra");

  return {
    primaryClinicId: primary.clinicId,
    primaryConnectionEvidence: primary.connectionEvidence,
    smokeRunId: primary.smokeRunId,
    smokeFinishedAt: primary.smokeFinishedAt,
    smokeStartedAt: primary.smokeStartedAt,
    primaryDeliveryId: primary.deliveryId,
    otherDeliveryId: other.deliveryId,
    otherClinicId: other.clinicId,
    superadminIdentityId,
    async cleanup() {
      await inSuperadminTransaction(
        superadminIdentityId,
        async (transaction) => {
          for (const clinicId of [primary.clinicId, other.clinicId]) {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${clinicId}, true)`,
            );
            await transaction
              .delete(transactionalDeliveries)
              .where(eq(transactionalDeliveries.clinicId, clinicId));
            await transaction
              .delete(appointments)
              .where(eq(appointments.clinicId, clinicId));
            await transaction
              .delete(whatsappContactConsents)
              .where(eq(whatsappContactConsents.clinicId, clinicId));
            await transaction
              .delete(whatsappIdentities)
              .where(eq(whatsappIdentities.clinicId, clinicId));
            await transaction
              .delete(contactPatientLinks)
              .where(eq(contactPatientLinks.clinicId, clinicId));
          }
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
            primaryOwnerIdentityId,
            otherOwnerIdentityId,
          ]),
        );
    },
  };
}
