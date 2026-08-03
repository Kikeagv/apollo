import { randomUUID } from "node:crypto";

import { inClinicTransaction } from "~/server/db/clinic-context";
import { identityAuditEvents, patients } from "~/server/db/schema";

/**
 * Registra un dato estrictamente sintético para verificar el recorrido clínico
 * de Panacea sin aceptar ni conservar contenido aportado por Pacientes.
 */
export async function performSyntheticClinicalAction(input: {
  clinicId: string;
  identityId: string;
}) {
  return inClinicTransaction(input, async (transaction) => {
    const [patient] = await transaction
      .insert(patients)
      .values({
        clinicId: input.clinicId,
        name: `Paciente sintético APO-30 ${randomUUID()}`,
      })
      .returning({ id: patients.id });
    if (patient === undefined) {
      throw new Error("No se pudo registrar la acción clínica sintética");
    }

    await transaction.insert(identityAuditEvents).values({
      action: "synthetic-clinical-action-performed",
      actorIdentityId: input.identityId,
      actorKind: "identity",
      clinicId: input.clinicId,
      result: "succeeded",
    });

    return { patientId: patient.id };
  });
}
