import { and, desc, eq, gt, sql } from "drizzle-orm";

import {
  assertSupportSessionIsUsable,
  type SupportSession,
  type SubscriptionStatusOperationResult,
  type SubscriptionSupportStore,
  type TransferPaymentOperationResult,
} from "~/server/application/subscription-support";
import {
  inClinicTransaction,
  inCommercialSubscriptionTransaction,
  inSuperadminTransaction,
} from "~/server/db/clinic-context";
import {
  apoloAuditEvents,
  clinics,
  clinicSupportSessions,
  transferPayments,
} from "~/server/db/schema";

export const drizzleSubscriptionSupportStore: SubscriptionSupportStore = {
  async assertSuperadmin(identityId) {
    await inSuperadminTransaction(identityId, async () => undefined);
  },

  async authorizeClinicIdentity(input) {
    await inClinicTransaction(input, async () => undefined);
  },

  async changeSubscriptionStatus(input) {
    return inCommercialSubscriptionTransaction(
      input.changedByIdentityId,
      async (transaction) => {
        const [audit] = await transaction
          .insert(apoloAuditEvents)
          .values({
            action: "subscription-status-changed",
            actorIdentityId: input.changedByIdentityId,
            clinicId: input.clinicId,
            operationKey: input.operationKey,
            subscriptionStatus: input.status,
          })
          .onConflictDoNothing({ target: apoloAuditEvents.operationKey })
          .returning({
            action: apoloAuditEvents.action,
            actorIdentityId: apoloAuditEvents.actorIdentityId,
            clinicId: apoloAuditEvents.clinicId,
            operationKey: apoloAuditEvents.operationKey,
            subscriptionStatus: apoloAuditEvents.subscriptionStatus,
          });
        if (audit === undefined) {
          const existing = await findAuditByOperationKey(
            transaction,
            input.operationKey,
          );
          assertMatchingAudit(existing, {
            action: "subscription-status-changed",
            actorIdentityId: input.changedByIdentityId,
            clinicId: input.clinicId,
            operationKey: input.operationKey,
            subscriptionStatus: input.status,
          });
          if (existing.subscriptionStatus === null) {
            throw new Error("La operación no conserva su resultado");
          }
          return {
            operationKey: input.operationKey,
            status: "succeeded",
            subscriptionStatus: existing.subscriptionStatus,
          } satisfies SubscriptionStatusOperationResult;
        }
        const [clinic] = await transaction
          .update(clinics)
          .set({ subscriptionStatus: input.status })
          .where(eq(clinics.id, input.clinicId))
          .returning({ id: clinics.id });
        if (clinic === undefined) throw new Error("La Clínica no existe");
        return {
          operationKey: input.operationKey,
          status: "succeeded",
          subscriptionStatus: input.status,
        } satisfies SubscriptionStatusOperationResult;
      },
    );
  },

  async createSupportSession(input) {
    return inSuperadminTransaction(
      input.superadminIdentityId,
      async (transaction) => {
        const existingBeforeInsert =
          await transaction.query.clinicSupportSessions.findFirst({
            where: eq(clinicSupportSessions.operationKey, input.operationKey),
            columns: {
              clinicId: true,
              expiresAt: true,
              id: true,
              operationKey: true,
              reason: true,
              superadminIdentityId: true,
            },
          });
        if (existingBeforeInsert !== undefined) {
          return recoverSupportSession(
            transaction,
            input,
            existingBeforeInsert,
          );
        }
        if (input.expiresAt.getTime() <= Date.now()) {
          throw new Error("El soporte requiere un vencimiento futuro");
        }
        const [session] = await transaction
          .insert(clinicSupportSessions)
          .values(input)
          .onConflictDoNothing({
            target: clinicSupportSessions.operationKey,
          })
          .returning({
            clinicId: clinicSupportSessions.clinicId,
            expiresAt: clinicSupportSessions.expiresAt,
            id: clinicSupportSessions.id,
            operationKey: clinicSupportSessions.operationKey,
            reason: clinicSupportSessions.reason,
            superadminIdentityId: clinicSupportSessions.superadminIdentityId,
          });
        if (session !== undefined) {
          await recordAtomicAuditEvent(transaction, {
            action: "support-session-opened",
            actorIdentityId: input.superadminIdentityId,
            clinicId: input.clinicId,
            operationKey: input.operationKey,
            supportSessionId: session.id,
          });
          return session;
        }

        const existing =
          await transaction.query.clinicSupportSessions.findFirst({
            where: eq(clinicSupportSessions.operationKey, input.operationKey),
            columns: {
              clinicId: true,
              expiresAt: true,
              id: true,
              operationKey: true,
              reason: true,
              superadminIdentityId: true,
            },
          });
        if (existing === undefined) {
          throw new Error("No se pudo recuperar la sesión de soporte");
        }
        return recoverSupportSession(transaction, input, existing);
      },
    );
  },

  async listSupportSessions(input) {
    return inClinicTransaction(
      { clinicId: input.clinicId, identityId: input.clinicIdentityId },
      async (transaction) =>
        transaction.query.clinicSupportSessions.findMany({
          columns: {
            clinicId: true,
            expiresAt: true,
            id: true,
            operationKey: true,
            reason: true,
            superadminIdentityId: true,
          },
          where: eq(clinicSupportSessions.clinicId, input.clinicId),
        }),
    );
  },

  async recordAuditEvent(input) {
    await inSuperadminTransaction(
      input.actorIdentityId,
      async (transaction) => {
        await transaction.insert(apoloAuditEvents).values({
          action: input.action,
          actorIdentityId: input.actorIdentityId,
          clinicId: input.clinicId,
          operationKey: input.operationKey,
          supportSessionId: input.supportSessionId,
        });
      },
    );
  },

  async recordTransferPayment(input) {
    const amountUsd = normalizeAmountUsd(input.amountUsd);
    return inSuperadminTransaction(
      input.recordedByIdentityId,
      async (transaction) => {
        const [payment] = await transaction
          .insert(transferPayments)
          .values({ ...input, amountUsd })
          .onConflictDoNothing({ target: transferPayments.operationKey })
          .returning({
            id: transferPayments.id,
            amountUsd: transferPayments.amountUsd,
            clinicId: transferPayments.clinicId,
            operationKey: transferPayments.operationKey,
            recordedAt: transferPayments.recordedAt,
            recordedByIdentityId: transferPayments.recordedByIdentityId,
            reference: transferPayments.reference,
          });
        if (payment !== undefined) {
          await recordAtomicAuditEvent(transaction, {
            action: "transfer-payment-recorded",
            actorIdentityId: input.recordedByIdentityId,
            clinicId: input.clinicId,
            operationKey: input.operationKey,
          });
          return toTransferPaymentResult(payment);
        }

        const existing = await transaction.query.transferPayments.findFirst({
          where: eq(transferPayments.operationKey, input.operationKey),
          columns: {
            id: true,
            amountUsd: true,
            clinicId: true,
            operationKey: true,
            recordedAt: true,
            recordedByIdentityId: true,
            reference: true,
          },
        });
        if (existing === undefined) {
          throw new Error("No se pudo recuperar el pago registrado");
        }
        if (
          existing.amountUsd !== amountUsd ||
          existing.clinicId !== input.clinicId ||
          existing.recordedByIdentityId !== input.recordedByIdentityId ||
          existing.reference !== input.reference
        ) {
          throw new Error("La clave de operación ya corresponde a otros datos");
        }
        const audit = await findAuditByOperationKey(
          transaction,
          input.operationKey,
        );
        assertMatchingAudit(audit, {
          action: "transfer-payment-recorded",
          actorIdentityId: input.recordedByIdentityId,
          clinicId: input.clinicId,
          operationKey: input.operationKey,
        });
        return toTransferPaymentResult(existing);
      },
    );
  },
};

export async function listRecentTransferPayments(input: {
  clinicId: string;
  superadminIdentityId: string;
}) {
  return inSuperadminTransaction(input.superadminIdentityId, (transaction) =>
    transaction.query.transferPayments.findMany({
      columns: {
        amountUsd: true,
        id: true,
        recordedAt: true,
        reference: true,
      },
      limit: 5,
      orderBy: [desc(transferPayments.recordedAt), desc(transferPayments.id)],
      where: eq(transferPayments.clinicId, input.clinicId),
    }),
  );
}

export async function listSuperadminSupportSessions(input: {
  clinicId: string;
  superadminIdentityId: string;
}) {
  return inSuperadminTransaction(input.superadminIdentityId, (transaction) =>
    transaction.query.clinicSupportSessions.findMany({
      columns: {
        createdAt: true,
        expiresAt: true,
        id: true,
        reason: true,
        superadminIdentityId: true,
      },
      limit: 10,
      orderBy: [
        desc(clinicSupportSessions.createdAt),
        desc(clinicSupportSessions.id),
      ],
      where: eq(clinicSupportSessions.clinicId, input.clinicId),
    }),
  );
}

type AtomicAuditInput = {
  action:
    | "subscription-status-changed"
    | "support-session-opened"
    | "transfer-payment-recorded";
  actorIdentityId: string;
  clinicId: string;
  operationKey: string;
  subscriptionStatus?: "active" | "suspended";
  supportSessionId?: string;
};

async function recoverSupportSession(
  transaction: Parameters<Parameters<typeof inSuperadminTransaction>[1]>[0],
  input: Omit<SupportSession, "id">,
  existing: SupportSession,
) {
  if (
    existing.clinicId !== input.clinicId ||
    existing.superadminIdentityId !== input.superadminIdentityId ||
    existing.reason !== input.reason ||
    existing.expiresAt.getTime() !== input.expiresAt.getTime()
  ) {
    throw new Error("La clave de operación ya corresponde a otros datos");
  }
  const audit = await findAuditByOperationKey(transaction, input.operationKey);
  assertMatchingAudit(audit, {
    action: "support-session-opened",
    actorIdentityId: input.superadminIdentityId,
    clinicId: input.clinicId,
    operationKey: input.operationKey,
    supportSessionId: existing.id,
  });
  return existing;
}

function normalizeAmountUsd(amountUsd: string) {
  const [whole = "", decimals] = amountUsd.split(".");
  if (decimals === undefined) return amountUsd;
  return `${whole.replace(/^0+(?=\d)/, "")}.${decimals}`;
}

async function recordAtomicAuditEvent(
  transaction: Parameters<Parameters<typeof inSuperadminTransaction>[1]>[0],
  input: AtomicAuditInput,
) {
  const [audit] = await transaction
    .insert(apoloAuditEvents)
    .values(input)
    .onConflictDoNothing({ target: apoloAuditEvents.operationKey })
    .returning({ id: apoloAuditEvents.id });
  if (audit === undefined) {
    throw new Error("La clave de operación ya corresponde a otra operación");
  }
}

async function findAuditByOperationKey(
  transaction: Parameters<Parameters<typeof inSuperadminTransaction>[1]>[0],
  operationKey: string,
) {
  return transaction.query.apoloAuditEvents.findFirst({
    where: eq(apoloAuditEvents.operationKey, operationKey),
    columns: {
      action: true,
      actorIdentityId: true,
      clinicId: true,
      operationKey: true,
      subscriptionStatus: true,
      supportSessionId: true,
    },
  });
}

function assertMatchingAudit(
  audit: Awaited<ReturnType<typeof findAuditByOperationKey>>,
  expected: AtomicAuditInput,
): asserts audit is NonNullable<typeof audit> & {
  subscriptionStatus: "active" | "suspended" | null;
} {
  if (audit === undefined) {
    throw new Error("La clave de operación ya corresponde a otra operación");
  }
  if (
    audit.action !== expected.action ||
    audit.actorIdentityId !== expected.actorIdentityId ||
    audit.clinicId !== expected.clinicId ||
    audit.operationKey !== expected.operationKey ||
    (expected.subscriptionStatus !== undefined &&
      audit.subscriptionStatus !== expected.subscriptionStatus) ||
    (expected.supportSessionId !== undefined &&
      audit.supportSessionId !== expected.supportSessionId)
  ) {
    throw new Error("La clave de operación ya corresponde a otra operación");
  }
  if (
    expected.action === "subscription-status-changed" &&
    audit.subscriptionStatus === null
  ) {
    throw new Error("La operación no conserva su resultado");
  }
}

function toTransferPaymentResult(payment: {
  id: string;
  recordedAt: Date;
  operationKey: string;
}): TransferPaymentOperationResult {
  return {
    operationKey: payment.operationKey,
    paymentId: payment.id,
    recordedAt: payment.recordedAt,
    status: "succeeded",
  };
}

export async function listVisibleClinicSupportSessions(input: {
  clinicId: string;
  identityId: string;
}) {
  return inClinicTransaction(input, async (transaction) => {
    const [sessions, accesses] = await Promise.all([
      transaction.query.clinicSupportSessions.findMany({
        columns: {
          createdAt: true,
          expiresAt: true,
          id: true,
          reason: true,
        },
        where: and(
          eq(clinicSupportSessions.clinicId, input.clinicId),
          gt(clinicSupportSessions.expiresAt, new Date()),
        ),
      }),
      transaction.query.apoloAuditEvents.findMany({
        columns: { occurredAt: true, supportSessionId: true },
        where: and(
          eq(apoloAuditEvents.clinicId, input.clinicId),
          eq(apoloAuditEvents.action, "support-access-used"),
        ),
      }),
    ]);
    return sessions.map((session) => ({
      ...session,
      accesses: accesses
        .filter((access) => access.supportSessionId === session.id)
        .map((access) => access.occurredAt),
    }));
  });
}

export async function listCommercialClinics(superadminIdentityId: string) {
  return inSuperadminTransaction(superadminIdentityId, async (transaction) =>
    transaction.query.clinics.findMany({
      columns: { id: true, name: true, subscriptionStatus: true },
      orderBy: clinics.name,
    }),
  );
}

/** Valida y registra un acceso de soporte antes de entrar al contexto clínico. */
export async function inAuditedSupportTransaction<T>(input: {
  clinicId: string;
  superadminIdentityId: string;
  supportSessionId: string;
  operation: (
    transaction: Parameters<Parameters<typeof inClinicTransaction>[1]>[0],
  ) => Promise<T>;
}) {
  return inSuperadminTransaction(
    input.superadminIdentityId,
    async (transaction) => {
      const session = await transaction.query.clinicSupportSessions.findFirst({
        where: and(
          eq(clinicSupportSessions.id, input.supportSessionId),
          eq(clinicSupportSessions.clinicId, input.clinicId),
          eq(
            clinicSupportSessions.superadminIdentityId,
            input.superadminIdentityId,
          ),
        ),
      });
      const authorizedSession = assertSupportSessionIsUsable(
        session,
        input,
        new Date(),
      );
      await transaction.insert(apoloAuditEvents).values({
        action: "support-access-used",
        actorIdentityId: input.superadminIdentityId,
        clinicId: input.clinicId,
        supportSessionId: authorizedSession.id,
      });
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${input.clinicId}, true)`,
      );
      await transaction.execute(
        sql`select set_config('app.support_session_id', ${authorizedSession.id}, true)`,
      );
      await transaction.execute(sql`set local role panacea_clinical_access`);
      return input.operation(transaction);
    },
  );
}

/** El permiso de soporte es mínimo: estado operativo, sin fichas ni agenda. */
export async function readAuditedSupportClinicSummary(input: {
  clinicId: string;
  superadminIdentityId: string;
  supportSessionId: string;
}) {
  return inAuditedSupportTransaction({
    ...input,
    operation: async (transaction) => {
      const clinic = await transaction.query.clinics.findFirst({
        columns: { name: true, subscriptionStatus: true },
        where: eq(clinics.id, input.clinicId),
      });
      if (clinic === undefined) throw new Error("La Clínica no existe");
      return clinic;
    },
  });
}
