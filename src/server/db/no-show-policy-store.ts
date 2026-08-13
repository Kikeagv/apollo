import { and, eq } from "drizzle-orm";

import type { NoShowPolicyStore } from "~/server/application/no-show-policy";
import { inClinicTransaction } from "~/server/db/clinic-context";
import { clinicUsers, clinics } from "~/server/db/schema";

/** Persistencia de la Política de inasistencia exclusiva del Médico propietario. */
export const drizzleNoShowPolicyStore: NoShowPolicyStore = {
  async getNoShowPolicy(input) {
    return inClinicTransaction(input, async (transaction) => {
      const owner = await transaction.query.clinicUsers.findFirst({
        columns: { id: true },
        where: and(
          eq(clinicUsers.clinicId, input.clinicId),
          eq(clinicUsers.identityId, input.identityId),
          eq(clinicUsers.role, "owner"),
          eq(clinicUsers.active, true),
        ),
      });
      if (owner === undefined) return undefined;
      return transaction.query.clinics
        .findFirst({
          columns: { noShowPolicy: true },
          where: eq(clinics.id, input.clinicId),
        })
        .then((clinic) => clinic?.noShowPolicy);
    });
  },

  async setNoShowPolicy(input) {
    return inClinicTransaction(input, async (transaction) => {
      const owner = await transaction.query.clinicUsers.findFirst({
        columns: { id: true },
        where: and(
          eq(clinicUsers.clinicId, input.clinicId),
          eq(clinicUsers.identityId, input.identityId),
          eq(clinicUsers.role, "owner"),
          eq(clinicUsers.active, true),
        ),
      });
      if (owner === undefined) return false;
      const [clinic] = await transaction
        .update(clinics)
        .set({ noShowPolicy: input.policy })
        .where(eq(clinics.id, input.clinicId))
        .returning({ id: clinics.id });
      return clinic !== undefined;
    });
  },
};
