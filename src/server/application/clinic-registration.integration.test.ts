import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { registerClinic, retryClinicInvitation } from "./clinic-registration";
import { db } from "../db";
import {
  inSuperadminRlsTransaction,
  inSuperadminTransaction,
} from "../db/clinic-context";
import { drizzleClinicRegistrationStore } from "../db/clinic-registration-store";
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
