import { describe, expect, it } from "vitest";

import {
  buildPanaceaConfigurationOverview,
  filterPanaceaConfigurationOverview,
  type PanaceaConfigurationOverviewInput,
} from "./panacea-configuration";

const initialConfiguration: PanaceaConfigurationOverviewInput = {
  availability: { activeSchedules: 1, futureCareOptions: 0 },
  services: { activeOffers: 0, activeServices: 0 },
  team: { activeDoctors: 2, completedProfiles: 1, pendingInvitations: 1 },
  whatsapp: { configured: false },
};

describe("progreso de Configuración de Panacea", () => {
  it("expone el siguiente paso de cada área sin ocultar una configuración parcial", () => {
    expect(buildPanaceaConfigurationOverview(initialConfiguration)).toEqual({
      areas: [
        expect.objectContaining({
          id: "team",
          nextAction: "Completar perfiles pendientes",
          progress: { completed: 1, total: 2 },
          status: "attention",
        }),
        expect.objectContaining({
          id: "services",
          nextAction: "Crear Servicio",
          progress: { completed: 0, total: 2 },
          status: "not-started",
        }),
        expect.objectContaining({
          id: "availability",
          nextAction: "Revisar capacidad",
          progress: { completed: 1, total: 2 },
          status: "attention",
        }),
        expect.objectContaining({
          id: "whatsapp",
          nextAction: "Configurar Atención por WhatsApp",
          progress: { completed: 0, total: 1 },
          status: "not-started",
        }),
      ],
      team: {
        activeDoctors: 2,
        completedProfiles: 1,
        incompleteProfiles: 1,
        pendingInvitations: 1,
      },
    });
  });

  it("marca lista una Clínica cuando el equipo y la capacidad mínima están completos", () => {
    const overview = buildPanaceaConfigurationOverview({
      availability: { activeSchedules: 1, futureCareOptions: 3 },
      services: { activeOffers: 2, activeServices: 1 },
      team: { activeDoctors: 2, completedProfiles: 2, pendingInvitations: 0 },
      whatsapp: { configured: true },
    });

    expect(overview.areas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "team", status: "complete" }),
        expect.objectContaining({ id: "services", status: "complete" }),
        expect.objectContaining({ id: "availability", status: "complete" }),
        expect.objectContaining({ id: "whatsapp", status: "complete" }),
      ]),
    );
  });

  it("filtra las áreas que el Médico no propietario no puede administrar", () => {
    const overview = buildPanaceaConfigurationOverview({
      availability: { activeSchedules: 1, futureCareOptions: 1 },
      services: { activeOffers: 1, activeServices: 1 },
      team: { activeDoctors: 1, completedProfiles: 1, pendingInvitations: 0 },
      whatsapp: { configured: true },
    });

    expect(
      filterPanaceaConfigurationOverview(overview, "doctor").areas,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "services" }),
        expect.objectContaining({ id: "availability" }),
      ]),
    );
    expect(
      filterPanaceaConfigurationOverview(overview, "doctor").areas,
    ).toHaveLength(2);
  });
});
