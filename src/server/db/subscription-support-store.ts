import { and, eq, sql } from "drizzle-orm";

import {
  assertSupportSessionIsUsable,
  type SubscriptionSupportStore,
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
    await inCommercialSubscriptionTransaction(
      input.changedByIdentityId,
      async (transaction) => {
        const [clinic] = await transaction
          .update(clinics)
          .set({ subscriptionStatus: input.status })
          .where(eq(clinics.id, input.clinicId))
          .returning({ id: clinics.id });
        if (clinic === undefined) throw new Error("La Clínica no existe");
      },
    );
  },

  async createSupportSession(input) {
    return inSuperadminTransaction(
      input.superadminIdentityId,
      async (transaction) => {
        const [session] = await transaction
          .insert(clinicSupportSessions)
          .values(input)
          .returning({
            clinicId: clinicSupportSessions.clinicId,
            expiresAt: clinicSupportSessions.expiresAt,
            id: clinicSupportSessions.id,
            reason: clinicSupportSessions.reason,
            superadminIdentityId: clinicSupportSessions.superadminIdentityId,
          });
        if (session === undefined)
          throw new Error("No se pudo abrir el soporte");
        return session;
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
          supportSessionId: input.supportSessionId,
        });
      },
    );
  },

  async recordTransferPayment(input) {
    await inSuperadminTransaction(
      input.recordedByIdentityId,
      async (transaction) => {
        await transaction.insert(transferPayments).values(input);
      },
    );
  },
};

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
        where: eq(clinicSupportSessions.clinicId, input.clinicId),
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
