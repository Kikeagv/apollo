import { and, eq, gte, lt, sql } from "drizzle-orm";

import {
  PASSWORD_BLOCK_WINDOW_MS,
  type IdentityPasswordBlockStore,
} from "~/server/application/identity-password-block";
import { db } from "~/server/db";
import { identityLoginFailures } from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function setIdentityContext(
  transaction: ClinicTransaction,
  identityId: string,
) {
  await transaction.execute(
    sql`select set_config('app.identity_id', ${identityId}, true)`,
  );
}

/**
 * Almacén de intentos fallidos. Cada Identidad solo ve sus propios intentos
 * por RLS; la poda conserva únicamente la ventana del Bloqueo temporal.
 */
export const drizzleIdentityPasswordBlockStore: IdentityPasswordBlockStore = {
  async recordFailure({ identityId, now }) {
    return db.transaction(async (transaction) => {
      await setIdentityContext(transaction, identityId);
      await transaction
        .delete(identityLoginFailures)
        .where(
          and(
            eq(identityLoginFailures.identityId, identityId),
            lt(
              identityLoginFailures.failedAt,
              new Date(now.getTime() - PASSWORD_BLOCK_WINDOW_MS),
            ),
          ),
        );
      await transaction
        .insert(identityLoginFailures)
        .values({ failedAt: now, identityId });
      const rows = await transaction.query.identityLoginFailures.findMany({
        columns: { id: true },
        where: eq(identityLoginFailures.identityId, identityId),
      });
      return { failureCount: rows.length };
    });
  },

  async countRecentFailures({ identityId, since }) {
    return db.transaction(async (transaction) => {
      await setIdentityContext(transaction, identityId);
      const rows = await transaction.query.identityLoginFailures.findMany({
        columns: { failedAt: true },
        where: and(
          eq(identityLoginFailures.identityId, identityId),
          gte(identityLoginFailures.failedAt, since),
        ),
      });
      const latestAt = rows.reduce<Date | undefined>(
        (latest, row) =>
          latest === undefined || row.failedAt > latest ? row.failedAt : latest,
        undefined,
      );
      return { count: rows.length, latestAt };
    });
  },

  async clearFailures(identityId) {
    await db.transaction(async (transaction) => {
      await setIdentityContext(transaction, identityId);
      await transaction
        .delete(identityLoginFailures)
        .where(eq(identityLoginFailures.identityId, identityId));
    });
  },
};
