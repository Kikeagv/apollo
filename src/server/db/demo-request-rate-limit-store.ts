import { and, eq, gte, lt, sql } from "drizzle-orm";

import {
  MAX_DEMO_REQUESTS_PER_EMAIL,
  MAX_DEMO_REQUESTS_PER_IP,
  DEMO_REQUEST_WINDOW_MS,
  type DemoRequestRateLimitScope,
  type DemoRequestRateLimitStore,
} from "~/server/application/demo-request";
import { db } from "~/server/db";
import { demoRequestRateLimitAttempts } from "~/server/db/schema";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function setRateLimitContext(
  transaction: DatabaseTransaction,
  scope: DemoRequestRateLimitScope,
  keyHash: string,
) {
  await transaction.execute(sql`set local role panacea_clinical_access`);
  await transaction.execute(
    sql`select set_config('app.demo_request_rate_limit_scope', ${scope}, true)`,
  );
  await transaction.execute(
    sql`select set_config('app.demo_request_rate_limit_key', ${keyHash}, true)`,
  );
}

async function countRecentInTransaction(
  transaction: DatabaseTransaction,
  input: {
    keyHash: string;
    scope: DemoRequestRateLimitScope;
    since: Date;
  },
) {
  await setRateLimitContext(transaction, input.scope, input.keyHash);
  const rows = await transaction.query.demoRequestRateLimitAttempts.findMany({
    columns: { id: true },
    where: and(
      eq(demoRequestRateLimitAttempts.scope, input.scope),
      eq(demoRequestRateLimitAttempts.keyHash, input.keyHash),
      gte(demoRequestRateLimitAttempts.requestedAt, input.since),
    ),
  });
  return rows.length;
}

async function lockRateLimitKeys(
  transaction: DatabaseTransaction,
  keyHashes: string[],
) {
  for (const keyHash of [...new Set(keyHashes)].sort()) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${keyHash}, 0))`,
    );
  }
}

/**
 * Persistencia de los límites anónimos. RLS acota cada lectura/escritura a la
 * clave hash que la transacción acaba de fijar; no guarda el Lead.
 */
export const drizzleDemoRequestRateLimitStore: DemoRequestRateLimitStore = {
  async countRecent({ keyHash, scope, since }) {
    return db.transaction((transaction) =>
      countRecentInTransaction(transaction, { keyHash, scope, since }),
    );
  },

  async reserve({ emailHash, ipHash, since, requestedAt }) {
    return db.transaction(async (transaction) => {
      await setRateLimitContext(transaction, "ip", ipHash);
      await lockRateLimitKeys(transaction, [ipHash, emailHash]);

      const ipRecent = await countRecentInTransaction(transaction, {
        keyHash: ipHash,
        scope: "ip",
        since,
      });
      if (ipRecent >= MAX_DEMO_REQUESTS_PER_IP) return false;

      const emailRecent = await countRecentInTransaction(transaction, {
        keyHash: emailHash,
        scope: "email",
        since,
      });
      if (emailRecent >= MAX_DEMO_REQUESTS_PER_EMAIL) return false;

      await setRateLimitContext(transaction, "ip", ipHash);
      await transaction.insert(demoRequestRateLimitAttempts).values({
        keyHash: ipHash,
        requestedAt,
        scope: "ip",
      });
      await setRateLimitContext(transaction, "email", emailHash);
      await transaction.insert(demoRequestRateLimitAttempts).values({
        keyHash: emailHash,
        requestedAt,
        scope: "email",
      });
      await transaction.execute(
        sql`select set_config('app.demo_request_rate_limit_prune', 'true', true)`,
      );
      await transaction
        .delete(demoRequestRateLimitAttempts)
        .where(
          lt(
            demoRequestRateLimitAttempts.requestedAt,
            new Date(requestedAt.getTime() - 2 * DEMO_REQUEST_WINDOW_MS),
          ),
        );
      return true;
    });
  },
};
