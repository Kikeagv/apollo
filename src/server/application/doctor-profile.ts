import { and, eq } from "drizzle-orm";

import { inClinicTransaction } from "~/server/db/clinic-context";
import { recalculateClinicReadiness } from "~/server/db/clinic-setup-store";
import {
  clinicUsers,
  configurationAuditEvents,
  doctors,
} from "~/server/db/schema";

const MAX_PUBLIC_NAME_LENGTH = 120;
const MAX_PRIMARY_SPECIALTY_LENGTH = 160;

export type OwnDoctorProfile = {
  id: string;
  primarySpecialty: string | null;
  publicName: string | null;
};

export type DoctorProfileUpdater = {
  complete(input: {
    clinicId: string;
    identityId: string;
    primarySpecialty: string;
    publicName: string;
  }): Promise<OwnDoctorProfile | undefined>;
};

export class DoctorProfileAccessError extends Error {
  constructor() {
    super("La Identidad no puede configurar un perfil de Médico");
    this.name = "DoctorProfileAccessError";
  }
}

/** Completa el perfil propio; una Secretaria nunca obtiene acceso de configuración. */
export async function completeOwnDoctorProfile(
  input: {
    clinicId: string;
    identityId: string;
    primarySpecialty: string;
    publicName: string;
  },
  updater: DoctorProfileUpdater = drizzleDoctorProfileUpdater,
) {
  const publicName = requiredText(
    input.publicName,
    "El nombre público es obligatorio",
    MAX_PUBLIC_NAME_LENGTH,
  );
  const primarySpecialty = requiredText(
    input.primarySpecialty,
    "La especialidad principal es obligatoria",
    MAX_PRIMARY_SPECIALTY_LENGTH,
  );
  const profile = await updater.complete({
    clinicId: input.clinicId,
    identityId: input.identityId,
    primarySpecialty,
    publicName,
  });
  if (profile === undefined) throw new DoctorProfileAccessError();
  return profile;
}

/** Consulta el perfil propio dentro del mismo contexto que protege RLS. */
export async function findOwnDoctorProfile(input: {
  clinicId: string;
  identityId: string;
}): Promise<OwnDoctorProfile | undefined> {
  return inClinicTransaction(input, async (transaction) => {
    const membership = await transaction.query.clinicUsers.findFirst({
      columns: { id: true },
      where: and(
        eq(clinicUsers.clinicId, input.clinicId),
        eq(clinicUsers.identityId, input.identityId),
      ),
    });
    if (membership === undefined) return undefined;

    return transaction.query.doctors.findFirst({
      columns: {
        id: true,
        primarySpecialty: true,
        publicName: true,
      },
      where: and(
        eq(doctors.clinicId, input.clinicId),
        eq(doctors.clinicUserId, membership.id),
      ),
    });
  });
}

export const drizzleDoctorProfileUpdater: DoctorProfileUpdater = {
  async complete(input) {
    return inClinicTransaction(input, async (transaction) => {
      const membership = await transaction.query.clinicUsers.findFirst({
        columns: { id: true, role: true },
        where: and(
          eq(clinicUsers.clinicId, input.clinicId),
          eq(clinicUsers.identityId, input.identityId),
        ),
      });
      if (membership === undefined || membership.role === "secretary") {
        return undefined;
      }

      const profile = await transaction.query.doctors.findFirst({
        columns: {
          id: true,
          primarySpecialty: true,
          publicName: true,
        },
        where: and(
          eq(doctors.clinicId, input.clinicId),
          eq(doctors.clinicUserId, membership.id),
        ),
      });
      if (profile === undefined) return undefined;

      const [updated] = await transaction
        .update(doctors)
        .set({
          primarySpecialty: input.primarySpecialty,
          publicName: input.publicName,
        })
        .where(eq(doctors.id, profile.id))
        .returning({
          id: doctors.id,
          primarySpecialty: doctors.primarySpecialty,
          publicName: doctors.publicName,
        });
      if (updated === undefined) return undefined;

      await transaction.insert(configurationAuditEvents).values({
        action: "doctor-profile-completed",
        actorIdentityId: input.identityId,
        afterValues: {
          primarySpecialty: updated.primarySpecialty,
          publicName: updated.publicName,
        },
        beforeValues: {
          primarySpecialty: profile.primarySpecialty,
          publicName: profile.publicName,
        },
        clinicId: input.clinicId,
        entity: "doctor-profile",
        entityId: profile.id,
      });
      await recalculateClinicReadiness(transaction, {
        actorIdentityId: input.identityId,
        clinicId: input.clinicId,
      });
      return updated;
    });
  },
};

function requiredText(value: string, message: string, maximumLength: number) {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(message);
  if (normalized.length > maximumLength) {
    throw new Error(`El valor no puede exceder ${maximumLength} caracteres`);
  }
  return normalized;
}
