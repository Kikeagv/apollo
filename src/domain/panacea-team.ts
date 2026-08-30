export type DoctorProfileFields = {
  primarySpecialty: string | null;
  publicName: string | null;
};

export type DoctorProfileProgress = {
  completedSteps: number;
  status: "complete" | "incomplete";
  totalSteps: 2;
};

/** Calcula el progreso visible sin hacer que un perfil incompleto bloquee Panacea. */
export function doctorProfileProgress(
  profile: DoctorProfileFields,
): DoctorProfileProgress {
  const completedSteps = [profile.publicName, profile.primarySpecialty].filter(
    (value) => value !== null && value.trim().length > 0,
  ).length;
  return {
    completedSteps,
    status: completedSteps === 2 ? "complete" : "incomplete",
    totalSteps: 2,
  };
}
