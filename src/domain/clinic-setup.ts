export const CLINIC_TERMS_URL = "https://www.usepraxia.com/terminos";

export const CLINIC_SETUP_STEPS = [
  {
    description: "Identidad y datos que verá el equipo de la Clínica.",
    href: "/configuracion/inicial?step=clinic",
    id: "clinic",
    label: "Datos básicos de la Clínica",
  },
  {
    description: "Médicos, invitaciones y perfiles que pueden atender.",
    href: "/configuracion/equipo",
    id: "team",
    label: "Equipo y perfiles",
  },
  {
    description: "Servicios con al menos una Oferta activa.",
    href: "/configuracion/servicios",
    id: "services",
    label: "Servicios y Ofertas",
  },
  {
    description: "Horarios vigentes y capacidad futura de atención.",
    href: "/configuracion/disponibilidad",
    id: "availability",
    label: "Horarios y Disponibilidad",
  },
  {
    description:
      "Revise la primera ruta válida antes de habilitar la atención por WhatsApp de Praxia.",
    href: "/configuracion/inicial?step=review",
    id: "review",
    label: "Revisión de capacidad",
  },
] as const;

export type ClinicSetupStepId = (typeof CLINIC_SETUP_STEPS)[number]["id"];
export type ClinicReadinessStatus = "pending" | "ready";

export type ClinicTermsAcceptance = {
  acceptedAt: Date | null;
  isCurrent: boolean;
  version: string | null;
};

export type ClinicTermsAcceptanceInput = {
  version: string;
};

export type ClinicTermsContract = {
  acceptanceErrorMessage: string;
  currentVersion: string;
};

export class ClinicTermsAcceptanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClinicTermsAcceptanceError";
  }
}

export type ClinicSetupFirstValidRoute = {
  doctor: {
    id: string;
    name: string;
    specialty: string;
  };
  firstOptionStartsAt: Date;
  scheduleEffectiveFrom: string;
  service: {
    durationMinutes: number;
    id: string;
    name: string;
  };
};

export type ClinicSetupEvaluationInput = {
  availability: {
    activeSchedules: number;
    futureCareOptions: number;
  };
  clinic: {
    asclepioEnabled: boolean;
    currentStep: number;
    name: string;
  };
  firstValidRoute?: ClinicSetupFirstValidRoute | null;
  services: {
    activeOffers: number;
    activeServices: number;
  };
  termsContract: ClinicTermsContract;
  termsAcceptance: ClinicTermsAcceptance;
  team: {
    activeDoctors: number;
    completedProfiles: number;
    pendingInvitations: number;
  };
};

export type ClinicSetupStep = (typeof CLINIC_SETUP_STEPS)[number] & {
  state: "complete" | "current" | "pending";
  summary: string;
};

export type ClinicSetupBlocker = {
  code: "availability" | "basic" | "capacity" | "services" | "team";
  message: string;
};

export type ClinicSetupPartialConfiguration = {
  code: "incomplete-team" | "pending-invitations";
  count: number;
  message: string;
};

export type ClinicSetupReview = {
  blockers: ClinicSetupBlocker[];
  canDeclareReady: boolean;
  clinicName: string;
  currentStep: ClinicSetupStepId;
  firstValidRoute: ClinicSetupFirstValidRoute | null;
  partialConfiguration: ClinicSetupPartialConfiguration[];
  progress: { completed: number; total: number };
  readiness: {
    asclepioEnabled: boolean;
    status: ClinicReadinessStatus;
  };
  steps: ClinicSetupStep[];
  termsAcceptance: {
    accepted: boolean;
    acceptedAt: Date | null;
    currentVersion: string;
    version: string | null;
  };
};

/**
 * Construye el estado resumible de la configuración inicial desde los
 * agregados que ya gobiernan Equipo, Servicios y Agenda.
 */
export function buildClinicSetupReview(
  input: ClinicSetupEvaluationInput,
): ClinicSetupReview {
  const currentStep = stepIdFromNumber(input.clinic.currentStep);
  const firstValidRoute = input.firstValidRoute ?? null;
  const termsAccepted = input.termsAcceptance.isCurrent;
  const prerequisites = [
    input.clinic.name.trim().length > 0,
    input.team.completedProfiles > 0,
    input.services.activeOffers > 0,
    input.availability.futureCareOptions > 0,
    firstValidRoute !== null,
  ];
  const completedSteps = prerequisites.filter(Boolean).length;
  const currentStepIndex = CLINIC_SETUP_STEPS.findIndex(
    (step) => step.id === currentStep,
  );

  const steps = CLINIC_SETUP_STEPS.map((step, index) => ({
    ...step,
    state:
      index === currentStepIndex
        ? ("current" as const)
        : prerequisites[index]
          ? ("complete" as const)
          : ("pending" as const),
    summary: stepSummary(step.id, input),
  }));

  const blockers = clinicSetupBlockers(input, firstValidRoute);
  const partialConfiguration = partialConfigurationFor(input);
  const readinessStatus: ClinicReadinessStatus =
    firstValidRoute === null ? "pending" : "ready";

  return {
    blockers,
    canDeclareReady: firstValidRoute !== null && termsAccepted,
    clinicName: input.clinic.name,
    currentStep,
    firstValidRoute,
    partialConfiguration,
    progress: { completed: completedSteps, total: CLINIC_SETUP_STEPS.length },
    readiness: {
      asclepioEnabled:
        input.clinic.asclepioEnabled && readinessStatus === "ready",
      status: readinessStatus,
    },
    steps,
    termsAcceptance: {
      accepted: termsAccepted,
      acceptedAt: input.termsAcceptance.acceptedAt,
      currentVersion: input.termsContract.currentVersion,
      version: input.termsAcceptance.version,
    },
  };
}

export function createCurrentClinicTermsAcceptance(
  currentVersion: string,
): ClinicTermsAcceptanceInput {
  return { version: currentVersion };
}

function clinicSetupBlockers(
  input: ClinicSetupEvaluationInput,
  firstValidRoute: ClinicSetupFirstValidRoute | null,
) {
  const blockers: ClinicSetupBlocker[] = [];

  if (input.clinic.name.trim().length === 0) {
    blockers.push({
      code: "basic",
      message: "Completa los datos básicos de la Clínica.",
    });
  }
  if (input.team.completedProfiles === 0) {
    blockers.push({
      code: "team",
      message: "Completa el perfil de al menos un Médico elegible.",
    });
  }
  if (input.services.activeOffers === 0) {
    blockers.push({
      code: "services",
      message: "Crea un Servicio con al menos una Oferta activa.",
    });
  }
  if (input.availability.futureCareOptions === 0) {
    blockers.push({
      code: "availability",
      message: "Define un Horario vigente que produzca Opciones futuras.",
    });
  }
  if (
    firstValidRoute === null &&
    input.team.completedProfiles > 0 &&
    input.services.activeOffers > 0 &&
    input.availability.activeSchedules > 0 &&
    input.availability.futureCareOptions > 0
  ) {
    blockers.push({
      code: "capacity",
      message: "No se encontró una ruta completa de Médico, Oferta y Horario.",
    });
  }

  return blockers;
}

function partialConfigurationFor(input: ClinicSetupEvaluationInput) {
  const partial: ClinicSetupPartialConfiguration[] = [];
  const incompleteProfiles = Math.max(
    input.team.activeDoctors - input.team.completedProfiles,
    0,
  );

  if (incompleteProfiles > 0) {
    partial.push({
      code: "incomplete-team",
      count: incompleteProfiles,
      message: `${incompleteProfiles} perfil${incompleteProfiles === 1 ? "" : "es"} de Médico aún no está${incompleteProfiles === 1 ? "" : "n"} completo${incompleteProfiles === 1 ? "" : "s"}.`,
    });
  }
  if (input.team.pendingInvitations > 0) {
    partial.push({
      code: "pending-invitations",
      count: input.team.pendingInvitations,
      message: `${input.team.pendingInvitations} invitación${input.team.pendingInvitations === 1 ? "" : "es"} de Médico pendiente${input.team.pendingInvitations === 1 ? "" : "s"}.`,
    });
  }
  return partial;
}

function stepSummary(
  step: ClinicSetupStepId,
  input: ClinicSetupEvaluationInput,
) {
  switch (step) {
    case "clinic":
      return input.clinic.name.trim().length > 0
        ? "Datos básicos guardados"
        : "Completar datos básicos";
    case "team":
      return input.team.completedProfiles > 0
        ? `${input.team.completedProfiles} Médico${input.team.completedProfiles === 1 ? "" : "s"} elegible${input.team.completedProfiles === 1 ? "" : "s"}`
        : "Completar el primer perfil de Médico";
    case "services":
      return input.services.activeOffers > 0
        ? `${input.services.activeOffers} Oferta${input.services.activeOffers === 1 ? "" : "s"} activa${input.services.activeOffers === 1 ? "" : "s"}`
        : input.services.activeServices > 0
          ? "Agregar una Oferta activa"
          : "Crear el primer Servicio";
    case "availability":
      return input.availability.futureCareOptions > 0
        ? `${input.availability.futureCareOptions} Opción${input.availability.futureCareOptions === 1 ? "" : "es"} futura${input.availability.futureCareOptions === 1 ? "" : "s"}`
        : input.availability.activeSchedules > 0
          ? "Revisar capacidad futura"
          : "Definir el primer Horario vigente";
    case "review":
      return input.firstValidRoute === undefined ||
        input.firstValidRoute === null
        ? "Revisión pendiente"
        : "Primera ruta válida encontrada";
  }
}

function stepIdFromNumber(value: number): ClinicSetupStepId {
  const index = Math.min(
    Math.max(Number.isFinite(value) ? Math.trunc(value) : 1, 1),
    CLINIC_SETUP_STEPS.length,
  );
  return CLINIC_SETUP_STEPS[index - 1]?.id ?? "clinic";
}
