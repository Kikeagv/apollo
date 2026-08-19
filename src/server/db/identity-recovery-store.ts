import { and, eq, gte, lt, sql } from "drizzle-orm";

import {
  RECOVERY_REQUEST_WINDOW_MS,
  type IdentityRecoveryRequestStore,
} from "~/server/application/identity-recovery";
import { db } from "~/server/db";
import { identityRecoveryRequests } from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * RLS permite tocar únicamente las filas cuyo hash de IP coincide con el
 * contexto `app.recovery_request_ip` fijado por esta transacción. El filtro
 * explícito por hash se conserva además: el rol de superusuario de desarrollo
 * elude RLS y el conteo debe ser correcto en cualquier rol.
 */
async function setRecoveryIpContext(
  transaction: ClinicTransaction,
  ipHash: string,
) {
  await transaction.execute(
    sql`select set_config('app.recovery_request_ip', ${ipHash}, true)`,
  );
}

/**
 * Ventana deslizante de solicitudes de restablecimiento por IP. Conserva solo
 * hashes de IP y poda registros viejos en cada escritura.
 */
export const drizzleIdentityRecoveryRequestStore: IdentityRecoveryRequestStore =
  {
    async countRecent({ ipHash, since }) {
      return db.transaction(async (transaction) => {
        await setRecoveryIpContext(transaction, ipHash);
        const rows = await transaction.query.identityRecoveryRequests.findMany({
          columns: { id: true },
          where: and(
            eq(identityRecoveryRequests.ipHash, ipHash),
            gte(identityRecoveryRequests.requestedAt, since),
          ),
        });
        return rows.length;
      });
    },

    async record({ ipHash, requestedAt }) {
      await db.transaction(async (transaction) => {
        await setRecoveryIpContext(transaction, ipHash);
        await transaction
          .insert(identityRecoveryRequests)
          .values({ ipHash, requestedAt });
        await transaction
          .delete(identityRecoveryRequests)
          .where(
            and(
              eq(identityRecoveryRequests.ipHash, ipHash),
              lt(
                identityRecoveryRequests.requestedAt,
                new Date(
                  requestedAt.getTime() - 2 * RECOVERY_REQUEST_WINDOW_MS,
                ),
              ),
            ),
          );
      });
    },
  };
