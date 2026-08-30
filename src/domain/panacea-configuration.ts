import {
  PANACEA_CONFIGURATION_SECTIONS,
  visiblePanaceaConfigurationSections,
  type PanaceaRole,
  type PanaceaConfigurationSection,
} from "./panacea-shell";

export type PanaceaConfigurationAreaStatus =
  "complete" | "attention" | "not-started";

export type PanaceaConfigurationOverviewInput = {
  availability: {
    activeSchedules: number;
    futureCareOptions: number;
  };
  services: {
    activeOffers: number;
    activeServices: number;
  };
  team: {
    activeDoctors: number;
    completedProfiles: number;
    pendingInvitations: number;
  };
  whatsapp: {
    configured: boolean;
  };
};

export type PanaceaConfigurationArea = {
  description: string;
  href: string;
  id: PanaceaConfigurationSection;
  label: string;
  nextAction: string;
  progress: { completed: number; total: number };
  status: PanaceaConfigurationAreaStatus;
};

export type PanaceaConfigurationOverview = {
  areas: PanaceaConfigurationArea[];
  team: PanaceaConfigurationOverviewInput["team"] & {
    incompleteProfiles: number;
  };
};

/** Convierte los registros actuales de capacidad en una guía accionable. */
export function buildPanaceaConfigurationOverview(
  input: PanaceaConfigurationOverviewInput,
): PanaceaConfigurationOverview {
  const incompleteProfiles = Math.max(
    input.team.activeDoctors - input.team.completedProfiles,
    0,
  );
  const progressBySection: Record<
    PanaceaConfigurationSection,
    Omit<PanaceaConfigurationArea, "description" | "href" | "id" | "label">
  > = {
    team: {
      nextAction:
        incompleteProfiles > 0
          ? "Completar perfiles pendientes"
          : input.team.pendingInvitations > 0
            ? "Revisar invitaciones"
            : "Equipo listo",
      progress: {
        completed: input.team.completedProfiles,
        total: input.team.activeDoctors,
      },
      status:
        input.team.activeDoctors === 0 && input.team.pendingInvitations === 0
          ? "not-started"
          : incompleteProfiles > 0 || input.team.pendingInvitations > 0
            ? "attention"
            : "complete",
    },
    services: {
      nextAction:
        input.services.activeServices === 0
          ? "Crear Servicio"
          : input.services.activeOffers === 0
            ? "Agregar Oferta de servicio"
            : "Catálogo listo",
      progress: {
        completed:
          (input.services.activeServices > 0 ? 1 : 0) +
          (input.services.activeOffers > 0 ? 1 : 0),
        total: 2,
      },
      status: areaStatus(
        input.services.activeServices > 0 && input.services.activeOffers > 0,
        input.services.activeServices > 0 || input.services.activeOffers > 0,
      ),
    },
    availability: {
      nextAction:
        input.availability.activeSchedules === 0
          ? "Definir Horario vigente"
          : input.availability.futureCareOptions === 0
            ? "Revisar capacidad"
            : "Disponibilidad lista",
      progress: {
        completed:
          (input.availability.activeSchedules > 0 ? 1 : 0) +
          (input.availability.futureCareOptions > 0 ? 1 : 0),
        total: 2,
      },
      status: areaStatus(
        input.availability.activeSchedules > 0 &&
          input.availability.futureCareOptions > 0,
        input.availability.activeSchedules > 0 ||
          input.availability.futureCareOptions > 0,
      ),
    },
    whatsapp: {
      nextAction: input.whatsapp.configured
        ? "Configuración lista"
        : "Configurar Atención por WhatsApp",
      progress: {
        completed: input.whatsapp.configured ? 1 : 0,
        total: 1,
      },
      status: input.whatsapp.configured ? "complete" : "not-started",
    },
  };

  return {
    areas: PANACEA_CONFIGURATION_SECTIONS.map((section) => ({
      ...section,
      ...progressBySection[section.id],
    })),
    team: {
      ...input.team,
      incompleteProfiles,
    },
  };
}

/** Evita devolver estados de áreas fuera del alcance del rol clínico. */
export function filterPanaceaConfigurationOverview(
  overview: PanaceaConfigurationOverview,
  role: PanaceaRole,
): PanaceaConfigurationOverview {
  const visibleIds = new Set(
    visiblePanaceaConfigurationSections(role).map((section) => section.id),
  );
  return {
    ...overview,
    areas: overview.areas.filter((area) => visibleIds.has(area.id)),
  };
}

function areaStatus(complete: boolean, started: boolean) {
  if (complete) return "complete" as const;
  return started ? ("attention" as const) : ("not-started" as const);
}
