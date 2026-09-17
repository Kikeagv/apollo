import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { registerClinic, retryClinicInvitation } from "./clinic-registration";
import {
  acceptClinicOwnerInvitation,
  getClinicInvitationActivationMode,
} from "./accept-clinic-owner-invitation";
import { db } from "../db";
import {
  inSuperadminRlsTransaction,
  inSuperadminTransaction,
} from "../db/clinic-context";
import { drizzleClinicRegistrationStore } from "../db/clinic-registration-store";
import { hashClinicInvitationToken } from "../db/clinic-invitation-token";
import {
  apoloSuperadmins,
  clinicInvitationDeliveries,
  clinicInvitations,
  clinicReadiness,
  clinics,
  user as identities,
  whatsappConnections,
} from "../db/schema";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("alta comercial y sintética recuperable", () => {
  databaseTest(
    "renueva la invitación vencida sobre la misma Clínica e invalida el token anterior",
    async () => {
      const identityId = `apo-96-superadmin-${randomUUID()}`;
      const registrationKey = `apo-96-renewal-${randomUUID()}`;
      const sentTokens: string[] = [];
      let clinicId: string | undefined;
      let ownerIdentityId: string | undefined;

      try {
        await db.insert(identities).values({
          id: identityId,
          name: "Superadmin de prueba APO-96",
          email: `${identityId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await db.insert(apoloSuperadmins).values({ identityId });

        const dependencies = {
          sendOwnerInvitation: async (invitation: { token: string }) => {
            sentTokens.push(invitation.token);
          },
          store: drizzleClinicRegistrationStore,
        };
        const first = await registerClinic(
          {
            actorIdentityId: identityId,
            clinicName: "Clínica Renovable APO-96",
            idempotencyKey: registrationKey,
            mode: "commercial",
            owner: {
              email: "owner.apo96@example.test",
              name: "Dra. Renovable APO-96",
            },
          },
          dependencies,
        );
        clinicId = first.clinic.id;
        const createdClinicId = first.clinic.id;
        const oldToken = sentTokens[0];
        if (oldToken === undefined) throw new Error("Falta token inicial");

        await inSuperadminTransaction(identityId, async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${createdClinicId}, true)`,
          );
          await transaction
            .update(clinicInvitations)
            .set({ expiresAt: new Date(Date.now() - 1) })
            .where(eq(clinicInvitations.clinicId, createdClinicId));
        });

        const expired = await drizzleClinicRegistrationStore.read({
          actorIdentityId: identityId,
          clinicId: createdClinicId,
        });
        expect(expired.invitation).toMatchObject({
          nextAction: "renew",
          status: "expired",
        });
        expect(expired.invitation.delivery.canRetry).toBe(true);

        const renewed = await retryClinicInvitation(
          { actorIdentityId: identityId, clinicId: createdClinicId },
          dependencies,
        );
        expect(renewed).toMatchObject({
          clinic: first.clinic,
          invitation: {
            id: first.invitation.id,
            nextAction: "accept",
            status: "pending",
          },
        });
        expect(sentTokens).toHaveLength(2);
        expect(sentTokens[1]).not.toBe(oldToken);
        const newToken = sentTokens[1];
        if (newToken === undefined) throw new Error("Falta token renovado");

        await expect(
          getClinicInvitationActivationMode({ token: oldToken }),
        ).rejects.toThrow("La invitación no es válida o venció");
        await expect(
          getClinicInvitationActivationMode({ token: newToken }),
        ).resolves.toBe("new");
        await expect(
          acceptClinicOwnerInvitation({
            password: "Contraseña-renovada-APO-96",
            token: oldToken,
          }),
        ).rejects.toThrow("La invitación no es válida o venció");
        const activation = await acceptClinicOwnerInvitation({
          password: "Contraseña-renovada-APO-96",
          token: newToken,
        });
        if (!activation.active) {
          throw new Error("La invitación renovada no produjo un acceso activo");
        }
        ownerIdentityId = activation.identityId;
        await expect(
          getClinicInvitationActivationMode({ token: newToken }),
        ).resolves.toBe("accepted");

        const persisted = await inSuperadminTransaction(
          identityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${createdClinicId}, true)`,
            );
            return transaction.query.clinicInvitations.findMany({
              columns: { tokenHash: true },
              where: eq(clinicInvitations.clinicId, createdClinicId),
            });
          },
        );
        expect(persisted).toHaveLength(1);
        expect(persisted[0]?.tokenHash).toBe(
          hashClinicInvitationToken(newToken),
        );
        expect(persisted[0]?.tokenHash).not.toBe(
          hashClinicInvitationToken(oldToken),
        );
      } finally {
        const cleanupClinicId = clinicId;
        if (cleanupClinicId !== undefined) {
          await inSuperadminTransaction(identityId, async (transaction) => {
            await transaction
              .delete(clinics)
              .where(eq(clinics.id, cleanupClinicId));
          });
        }
        await db
          .delete(apoloSuperadmins)
          .where(eq(apoloSuperadmins.identityId, identityId));
        if (ownerIdentityId !== undefined) {
          await db.delete(identities).where(eq(identities.id, ownerIdentityId));
        }
        await db.delete(identities).where(eq(identities.id, identityId));
      }
    },
  );

  databaseTest(
    "evita dos reintentos concurrentes sobre la misma invitación",
    async () => {
      const identityId = `apo-96-superadmin-${randomUUID()}`;
      const registrationKey = `apo-96-concurrent-${randomUUID()}`;
      const sentTokens: string[] = [];
      let clinicId: string | undefined;
      let resolveRetryStarted = () => undefined as void;
      let releaseRetry = () => undefined as void;
      const retryStarted = new Promise<void>((resolve) => {
        resolveRetryStarted = resolve;
      });
      const retryRelease = new Promise<void>((resolve) => {
        releaseRetry = resolve;
      });

      try {
        await db.insert(identities).values({
          id: identityId,
          name: "Superadmin concurrente APO-96",
          email: `${identityId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await db.insert(apoloSuperadmins).values({ identityId });

        const dependencies = {
          sendOwnerInvitation: async (invitation: { token: string }) => {
            sentTokens.push(invitation.token);
            if (sentTokens.length === 1) {
              throw new Error("Correo temporalmente no disponible");
            }
            if (sentTokens.length === 2) {
              resolveRetryStarted();
              await retryRelease;
            }
          },
          store: drizzleClinicRegistrationStore,
        };
        const first = await registerClinic(
          {
            actorIdentityId: identityId,
            clinicName: "Clínica Concurrente APO-96",
            idempotencyKey: registrationKey,
            mode: "commercial",
            owner: {
              email: "owner.concurrent.apo96@example.test",
              name: "Dra. Concurrente APO-96",
            },
          },
          dependencies,
        );
        clinicId = first.clinic.id;

        const firstRetry = retryClinicInvitation(
          { actorIdentityId: identityId, clinicId: first.clinic.id },
          dependencies,
        );
        await retryStarted;

        const concurrent = await retryClinicInvitation(
          { actorIdentityId: identityId, clinicId: first.clinic.id },
          dependencies,
        );
        expect(concurrent.invitation.delivery).toMatchObject({
          attempts: 1,
          canRetry: false,
          lastAttempt: "failed",
          status: "pending",
        });
        expect(concurrent.invitation.nextAction).toBe("wait-delivery");

        releaseRetry();
        await expect(firstRetry).resolves.toMatchObject({
          invitation: {
            delivery: { attempts: 2, lastAttempt: "succeeded" },
            nextAction: "accept",
          },
        });
        expect(sentTokens).toHaveLength(2);

        const deliveries = await inSuperadminTransaction(
          identityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${first.clinic.id}, true)`,
            );
            return transaction.query.clinicInvitationDeliveries.findMany({
              where: eq(clinicInvitationDeliveries.clinicId, first.clinic.id),
            });
          },
        );
        expect(deliveries).toHaveLength(2);
      } finally {
        releaseRetry();
        if (clinicId !== undefined) {
          await inSuperadminTransaction(identityId, async (transaction) => {
            await transaction.delete(clinics).where(eq(clinics.id, clinicId!));
          });
        }
        await db
          .delete(apoloSuperadmins)
          .where(eq(apoloSuperadmins.identityId, identityId));
        await db.delete(identities).where(eq(identities.id, identityId));
      }
    },
  );

  databaseTest(
    "mantiene una Clínica, una invitación y el historial aunque falle el correo",
    async () => {
      const identityId = `apo-95-superadmin-${randomUUID()}`;
      const email = `${identityId}@example.test`;
      const registrationKey = `apo-95-commercial-${randomUUID()}`;
      const syntheticRegistrationKey = `apo-95-synthetic-${randomUUID()}`;
      const createdClinicIds: string[] = [];
      let deliveryAttempts = 0;

      try {
        await db.insert(identities).values({
          id: identityId,
          name: "Superadmin de prueba APO-95",
          email,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await db.insert(apoloSuperadmins).values({ identityId });

        const sendOwnerInvitation = async () => {
          deliveryAttempts += 1;
          if (deliveryAttempts < 3) {
            throw new Error(`Correo no disponible (${deliveryAttempts})`);
          }
        };
        const dependencies = {
          sendOwnerInvitation,
          store: drizzleClinicRegistrationStore,
        };
        const commercialInput = {
          actorIdentityId: identityId,
          clinicName: "Clínica Comercial APO-95",
          idempotencyKey: registrationKey,
          mode: "commercial" as const,
          owner: {
            email: "ana.comercial@example.test",
            name: "Dra. Ana Comercial",
          },
        };

        const first = await registerClinic(commercialInput, dependencies);
        createdClinicIds.push(first.clinic.id);
        expect(first).toMatchObject({
          clinic: { isSynthetic: false, name: commercialInput.clinicName },
          invitation: {
            delivery: {
              attempts: 1,
              canRetry: true,
              lastAttempt: "failed",
              status: "pending",
            },
          },
        });

        const second = await retryClinicInvitation(
          { actorIdentityId: identityId, clinicId: first.clinic.id },
          dependencies,
        );
        expect(second.invitation.delivery).toMatchObject({
          attempts: 2,
          canRetry: true,
          lastAttempt: "failed",
          status: "pending",
        });

        const third = await retryClinicInvitation(
          { actorIdentityId: identityId, clinicId: first.clinic.id },
          dependencies,
        );
        expect(third).toMatchObject({
          clinic: first.clinic,
          invitation: {
            id: first.invitation.id,
            delivery: {
              attempts: 3,
              canRetry: false,
              lastAttempt: "succeeded",
              status: "sent",
            },
          },
        });

        const repeated = await registerClinic(commercialInput, {
          sendOwnerInvitation: async () => {
            throw new Error("No debe reenviar una invitación ya entregada");
          },
          store: drizzleClinicRegistrationStore,
        });
        expect(repeated.clinic.id).toBe(first.clinic.id);
        expect(repeated.invitation.id).toBe(first.invitation.id);
        expect(deliveryAttempts).toBe(3);

        const synthetic = await registerClinic(
          {
            actorIdentityId: identityId,
            clinicName: "Clínica Sintética APO-95",
            idempotencyKey: syntheticRegistrationKey,
            mode: "synthetic",
            owner: {
              email: "ana.synthetic@example.test",
              name: "Dra. Ana Sintética",
            },
          },
          dependencies,
        );
        createdClinicIds.push(synthetic.clinic.id);

        const persisted = await inSuperadminTransaction(
          identityId,
          async (transaction) => {
            const commercialClinic = await transaction.query.clinics.findFirst({
              where: eq(clinics.id, first.clinic.id),
            });
            const commercialConnection =
              await transaction.query.whatsappConnections.findFirst({
                where: eq(whatsappConnections.clinicId, first.clinic.id),
              });
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${first.clinic.id}, true)`,
            );
            const commercialInvitation =
              await transaction.query.clinicInvitations.findFirst({
                where: and(
                  eq(clinicInvitations.clinicId, first.clinic.id),
                  eq(clinicInvitations.role, "owner"),
                ),
              });
            const commercialDeliveries =
              await transaction.query.clinicInvitationDeliveries.findMany({
                where: eq(clinicInvitationDeliveries.clinicId, first.clinic.id),
              });
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${synthetic.clinic.id}, true)`,
            );
            const syntheticConnection =
              await transaction.query.whatsappConnections.findFirst({
                where: eq(whatsappConnections.clinicId, synthetic.clinic.id),
              });
            const syntheticReadiness =
              await transaction.query.clinicReadiness.findFirst({
                where: eq(clinicReadiness.clinicId, synthetic.clinic.id),
              });
            return {
              commercialClinic,
              commercialConnection,
              commercialDeliveries,
              commercialInvitation,
              syntheticConnection,
              syntheticReadiness,
            };
          },
        );

        expect(persisted.commercialClinic).toMatchObject({
          isSynthetic: false,
          name: commercialInput.clinicName,
          registrationKey,
        });
        expect(persisted.commercialConnection).toBeUndefined();
        expect(persisted.commercialInvitation).toMatchObject({
          email: commercialInput.owner.email,
          recipientName: commercialInput.owner.name,
        });
        expect(persisted.commercialDeliveries).toHaveLength(3);
        expect(persisted.commercialDeliveries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              failureReason: "Correo no disponible (1)",
              result: "failed",
            }),
            expect.objectContaining({
              failureReason: "Correo no disponible (2)",
              result: "failed",
            }),
            expect.objectContaining({
              failureReason: null,
              result: "succeeded",
            }),
          ]),
        );
        expect(persisted.syntheticConnection).toMatchObject({
          connectionType: "simulated",
          provider: "simulated",
          status: "ready",
        });
        expect(persisted.syntheticReadiness).toBeDefined();

        const rlsVisibility = await inSuperadminRlsTransaction(
          identityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${first.clinic.id}, true)`,
            );
            const visibleDeliveries =
              await transaction.query.clinicInvitationDeliveries.findMany({
                where: eq(clinicInvitationDeliveries.clinicId, first.clinic.id),
              });
            const hiddenDeliveries =
              await transaction.query.clinicInvitationDeliveries.findMany({
                where: eq(
                  clinicInvitationDeliveries.clinicId,
                  synthetic.clinic.id,
                ),
              });
            return { hiddenDeliveries, visibleDeliveries };
          },
        );
        expect(rlsVisibility.visibleDeliveries).toHaveLength(3);
        expect(rlsVisibility.hiddenDeliveries).toHaveLength(0);
      } finally {
        if (createdClinicIds.length > 0) {
          await inSuperadminTransaction(identityId, async (transaction) => {
            await transaction
              .delete(clinics)
              .where(inArray(clinics.id, createdClinicIds));
          });
        }
        await db
          .delete(apoloSuperadmins)
          .where(eq(apoloSuperadmins.identityId, identityId));
        await db.delete(identities).where(eq(identities.id, identityId));
      }
    },
  );
});
