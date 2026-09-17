import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";

import {
  getClinicInvitationNextAction,
  getClinicInvitationStatus,
} from "~/domain/clinic-invitation";
import {
  ClinicRegistrationConflictError,
  type ClinicRegistration,
  type ClinicRegistrationStore,
} from "~/server/application/clinic-registration";
import { createSimulatedWhatsAppConnection } from "~/domain/whatsapp-connection";
import {
  inSuperadminRlsTransaction,
  type ClinicTransaction,
} from "~/server/db/clinic-context";
import { hashClinicInvitationToken } from "~/server/db/clinic-invitation-token";
import {
  clinicInvitationDeliveries,
  clinicInvitations,
  clinicReadiness,
  clinics,
  identityAuditEvents,
  type SubscriptionStatus,
  whatsappConnections,
} from "~/server/db/schema";

const DELIVERY_LEASE_DURATION_MS = 5 * 60 * 1_000;

export const drizzleClinicRegistrationStore: ClinicRegistrationStore = {
  async register(input) {
    return inSuperadminRlsTransaction(
      input.actorIdentityId,
      async (transaction) => {
        const [createdClinic] = await transaction
          .insert(clinics)
          .values({
            isSynthetic: input.mode === "synthetic",
            name: input.clinicName,
            registrationKey: input.idempotencyKey,
            subscriptionStatus: "active",
          })
          .onConflictDoNothing({ target: clinics.registrationKey })
          .returning({
            id: clinics.id,
            isSynthetic: clinics.isSynthetic,
            name: clinics.name,
            subscriptionStatus: clinics.subscriptionStatus,
          });

        if (createdClinic !== undefined) {
          await setClinicContext(
            transaction,
            createdClinic.id,
            createdClinic.subscriptionStatus,
          );

          if (createdClinic.isSynthetic) {
            await transaction
              .insert(whatsappConnections)
              .values(createSimulatedWhatsAppConnection(createdClinic.id));
            await transaction.insert(clinicReadiness).values({
              clinicId: createdClinic.id,
            });
          }

          const [invitation] = await transaction
            .insert(clinicInvitations)
            .values({
              clinicId: createdClinic.id,
              deliveryAttemptId: input.invitation.deliveryAttemptId,
              deliveryLeaseExpiresAt: newDeliveryLeaseExpiresAt(),
              email: normalizeEmail(input.owner.email),
              expiresAt: input.invitation.expiresAt,
              recipientName: input.owner.name,
              role: "owner",
              tokenHash: hashClinicInvitationToken(input.invitation.token),
            })
            .returning({
              email: clinicInvitations.email,
              expiresAt: clinicInvitations.expiresAt,
              id: clinicInvitations.id,
              recipientName: clinicInvitations.recipientName,
            });
          if (invitation === undefined) {
            throw new Error("No se pudo crear la invitación del propietario");
          }

          await transaction.insert(identityAuditEvents).values({
            action: createdClinic.isSynthetic
              ? "synthetic-clinic-created"
              : "commercial-clinic-created",
            actorIdentityId: input.actorIdentityId,
            actorKind: "identity",
            clinicId: createdClinic.id,
            result: "succeeded",
          });

          return {
            created: true,
            registration: registrationFromValues({
              clinic: createdClinic,
              invitation,
            }),
          };
        }

        const existingClinic = await transaction.query.clinics.findFirst({
          columns: {
            id: true,
            isSynthetic: true,
            name: true,
            subscriptionStatus: true,
          },
          where: eq(clinics.registrationKey, input.idempotencyKey),
        });
        if (existingClinic === undefined) {
          throw new Error("No se pudo resolver el alta de la Clínica");
        }
        if (
          existingClinic.isSynthetic !== (input.mode === "synthetic") ||
          existingClinic.name !== input.clinicName
        ) {
          throw new ClinicRegistrationConflictError();
        }

        await setClinicContext(
          transaction,
          existingClinic.id,
          existingClinic.subscriptionStatus,
        );
        const existingInvitation =
          await transaction.query.clinicInvitations.findFirst({
            columns: {
              email: true,
              expiresAt: true,
              id: true,
              recipientName: true,
            },
            where: and(
              eq(clinicInvitations.clinicId, existingClinic.id),
              eq(clinicInvitations.role, "owner"),
            ),
          });
        if (
          existingInvitation?.email !== normalizeEmail(input.owner.email) ||
          existingInvitation?.recipientName !== input.owner.name
        ) {
          throw new ClinicRegistrationConflictError();
        }

        return {
          created: false,
          registration: await readRegistration(transaction, existingClinic.id),
        };
      },
    );
  },

  async prepareInvitationDelivery(input) {
    return inSuperadminRlsTransaction(
      input.actorIdentityId,
      async (transaction) => {
        const clinic = await transaction.query.clinics.findFirst({
          columns: { id: true, name: true, subscriptionStatus: true },
          where: eq(clinics.id, input.clinicId),
        });
        if (clinic === undefined) return undefined;

        await setClinicContext(
          transaction,
          clinic.id,
          clinic.subscriptionStatus,
        );
        const invitation = await transaction.query.clinicInvitations.findFirst({
          columns: {
            email: true,
            expiresAt: true,
            id: true,
            recipientName: true,
          },
          where: and(
            eq(clinicInvitations.clinicId, clinic.id),
            eq(clinicInvitations.role, "owner"),
            isNull(clinicInvitations.consumedAt),
          ),
        });
        if (invitation === undefined) return undefined;

        const deliveryAttemptId = randomUUID();
        const [rotatedInvitation] = await transaction
          .update(clinicInvitations)
          .set({
            deliveryAttemptId,
            deliveryLeaseExpiresAt: newDeliveryLeaseExpiresAt(),
            expiresAt: input.expiresAt,
            tokenHash: hashClinicInvitationToken(input.token),
          })
          .where(
            and(
              eq(clinicInvitations.id, invitation.id),
              isNull(clinicInvitations.consumedAt),
              or(
                isNull(clinicInvitations.deliveryLeaseExpiresAt),
                lt(clinicInvitations.deliveryLeaseExpiresAt, new Date()),
              ),
            ),
          )
          .returning({
            email: clinicInvitations.email,
            expiresAt: clinicInvitations.expiresAt,
            id: clinicInvitations.id,
            recipientName: clinicInvitations.recipientName,
          });
        if (rotatedInvitation === undefined) return undefined;

        return {
          clinicId: clinic.id,
          clinicName: clinic.name,
          deliveryAttemptId,
          email: rotatedInvitation.email,
          expiresAt: rotatedInvitation.expiresAt,
          invitationId: rotatedInvitation.id,
          recipientName: rotatedInvitation.recipientName,
          token: input.token,
        };
      },
    );
  },

  async read(input) {
    return inSuperadminRlsTransaction(
      input.actorIdentityId,
      async (transaction) => {
        const clinic = await transaction.query.clinics.findFirst({
          columns: { id: true, subscriptionStatus: true },
          where: eq(clinics.id, input.clinicId),
        });
        if (clinic === undefined) throw new Error("La Clínica no existe");
        await setClinicContext(
          transaction,
          clinic.id,
          clinic.subscriptionStatus,
        );
        return readRegistration(transaction, clinic.id);
      },
    );
  },

  async recordInvitationDelivery(input) {
    return inSuperadminRlsTransaction(
      input.actorIdentityId,
      async (transaction) => {
        const clinic = await transaction.query.clinics.findFirst({
          columns: { id: true, subscriptionStatus: true },
          where: eq(clinics.id, input.clinicId),
        });
        if (clinic === undefined) throw new Error("La Clínica no existe");
        await setClinicContext(
          transaction,
          clinic.id,
          clinic.subscriptionStatus,
        );

        const [releasedInvitation] = await transaction
          .update(clinicInvitations)
          .set({
            deliveryAttemptId: null,
            deliveryLeaseExpiresAt: null,
          })
          .where(
            and(
              eq(clinicInvitations.id, input.invitationId),
              eq(clinicInvitations.clinicId, clinic.id),
              eq(clinicInvitations.role, "owner"),
              eq(clinicInvitations.deliveryAttemptId, input.deliveryAttemptId),
              isNull(clinicInvitations.consumedAt),
            ),
          )
          .returning({ id: clinicInvitations.id });
        if (releasedInvitation === undefined) {
          return readRegistration(transaction, clinic.id);
        }

        await transaction.insert(clinicInvitationDeliveries).values({
          actorIdentityId: input.actorIdentityId,
          clinicId: clinic.id,
          failureReason:
            input.result === "failed"
              ? (input.failureReason ??
                "El proveedor de correo no pudo entregar la invitación")
              : null,
          invitationId: releasedInvitation.id,
          result: input.result,
        });
        await transaction.insert(identityAuditEvents).values({
          action: "clinic-owner-invited",
          actorIdentityId: input.actorIdentityId,
          actorKind: "identity",
          clinicId: clinic.id,
          result: input.result,
        });

        return readRegistration(transaction, clinic.id);
      },
    );
  },
};

async function setClinicContext(
  transaction: ClinicTransaction,
  clinicId: string,
  subscriptionStatus: SubscriptionStatus,
) {
  await transaction.execute(
    sql`select set_config('app.clinic_id', ${clinicId}, true)`,
  );
  await transaction.execute(
    sql`select set_config('app.subscription_status', ${subscriptionStatus}, true)`,
  );
}

async function readRegistration(
  transaction: ClinicTransaction,
  clinicId: string,
): Promise<ClinicRegistration> {
  const clinic = await transaction.query.clinics.findFirst({
    columns: { id: true, isSynthetic: true, name: true },
    where: eq(clinics.id, clinicId),
  });
  if (clinic === undefined) throw new Error("La Clínica no existe");

  const invitation = await transaction.query.clinicInvitations.findFirst({
    columns: {
      consumedAt: true,
      deliveryLeaseExpiresAt: true,
      email: true,
      expiresAt: true,
      id: true,
      recipientName: true,
    },
    where: and(
      eq(clinicInvitations.clinicId, clinicId),
      eq(clinicInvitations.role, "owner"),
    ),
  });
  if (invitation === undefined) {
    throw new Error("La invitación del propietario no existe");
  }

  const deliveries =
    await transaction.query.clinicInvitationDeliveries.findMany({
      columns: {
        failureReason: true,
        result: true,
      },
      orderBy: [
        desc(clinicInvitationDeliveries.occurredAt),
        desc(clinicInvitationDeliveries.id),
      ],
      where: and(
        eq(clinicInvitationDeliveries.clinicId, clinicId),
        eq(clinicInvitationDeliveries.invitationId, invitation.id),
      ),
    });
  const latest = deliveries[0];
  const status = latest?.result === "succeeded" ? "sent" : "pending";
  const deliveryInProgress =
    invitation.deliveryLeaseExpiresAt !== null &&
    invitation.deliveryLeaseExpiresAt > new Date();
  const invitationStatus = getClinicInvitationStatus({
    consumedAt: invitation.consumedAt,
    expiresAt: invitation.expiresAt,
  });

  return {
    clinic,
    invitation: {
      delivery: {
        attempts: deliveries.length,
        canRetry:
          !deliveryInProgress &&
          invitation.consumedAt === null &&
          (invitationStatus === "expired" || latest?.result !== "succeeded"),
        lastAttempt: latest?.result ?? null,
        lastError: latest?.failureReason ?? null,
        status,
      },
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      id: invitation.id,
      nextAction: getClinicInvitationNextAction({
        deliveryInProgress,
        lastDelivery: latest?.result ?? null,
        status: invitationStatus,
      }),
      recipientName: invitation.recipientName,
      status: invitationStatus,
    },
  };
}

function registrationFromValues(input: {
  clinic: { id: string; isSynthetic: boolean; name: string };
  invitation: {
    email: string;
    expiresAt: Date;
    id: string;
    recipientName: string;
  };
}): ClinicRegistration {
  return {
    clinic: input.clinic,
    invitation: {
      delivery: {
        attempts: 0,
        canRetry: false,
        lastAttempt: null,
        lastError: null,
        status: "pending",
      },
      ...input.invitation,
      nextAction: "wait-delivery",
      status: "pending",
    },
  };
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function newDeliveryLeaseExpiresAt() {
  return new Date(Date.now() + DELIVERY_LEASE_DURATION_MS);
}
