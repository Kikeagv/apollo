import { and, eq, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { apoloSuperadmins, clinicUsers } from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Fija el contexto de Identidad y Clínica dentro de una transacción antes de
 * que cualquier caso de uso clínico consulte o mute datos protegidos por RLS.
 */
export async function inClinicTransaction<T>(
  input: { clinicId: string; identityId: string },
  operation: (transaction: ClinicTransaction) => Promise<T>,
) {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`set local role panacea_clinical_access`);
    await transaction.execute(
      sql`select set_config('app.identity_id', ${input.identityId}, true)`,
    );

    const membership = await transaction.query.clinicUsers.findFirst({
      where: and(
        eq(clinicUsers.clinicId, input.clinicId),
        eq(clinicUsers.identityId, input.identityId),
        eq(clinicUsers.active, true),
      ),
    });
    if (membership === undefined)
      throw new Error("La Identidad no pertenece a la Clínica");

    await transaction.execute(
      sql`select set_config('app.clinic_id', ${input.clinicId}, true)`,
    );
    return operation(transaction);
  });
}

/** Camino operativo de Apolo: autoriza al operador sin asignarle un rol clínico. */
export async function inSuperadminTransaction<T>(
  identityId: string,
  operation: (transaction: ClinicTransaction) => Promise<T>,
) {
  return db.transaction(async (transaction) => {
    const operator = await transaction.query.apoloSuperadmins.findFirst({
      where: eq(apoloSuperadmins.identityId, identityId),
    });
    if (operator === undefined)
      throw new Error("La Identidad no es superadmin de Apolo");

    await transaction.execute(
      sql`select set_config('app.superadmin_id', ${identityId}, true)`,
    );
    return operation(transaction);
  });
}
