import { and, eq } from "drizzle-orm";

import type { NoShowPolicyStore } from "~/server/application/no-show-policy";
import { inClinicTransaction } from "~/server/db/clinic-context";
import { clinicUsers, clinics } from "~/server/db/schema";
import {
  lockWhatsAppOperationalPolicies,
  recordWhatsAppOperationalPolicyAudit,
} from "~/server/db/whatsapp-operational-policies-store";

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
      await lockWhatsAppOperationalPolicies(transaction, input.clinicId);
      const currentClinic = await transaction.query.clinics.findFirst({
        columns: { id: true, noShowPolicy: true },
        where: eq(clinics.id, input.clinicId),
      });
      if (currentClinic === undefined) return false;
      if (currentClinic.noShowPolicy === input.policy) return true;
      const [clinic] = await transaction
        .update(clinics)
        .set({ noShowPolicy: input.policy })
        .where(
          and(
            eq(clinics.id, input.clinicId),
            eq(clinics.noShowPolicy, currentClinic.noShowPolicy),
          ),
        )
        .returning({ id: clinics.id });
      if (clinic === undefined) return false;
      await recordWhatsAppOperationalPolicyAudit(transaction, {
        action: "whatsapp-no-show-policy-updated",
        actorIdentityId: input.identityId,
        afterValues: { noShowPolicy: input.policy },
        beforeValues: { noShowPolicy: currentClinic.noShowPolicy },
        clinicId: input.clinicId,
      });
      return true;
    });
  },
};
