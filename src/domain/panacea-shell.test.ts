import { describe, expect, it } from "vitest";

import {
  canAccessPanaceaConfigurationSection,
  canAccessPanaceaDestination,
  visiblePanaceaConfigurationSections,
  visiblePanaceaDestinations,
} from "./panacea-shell";

describe("política de navegación de Panacea", () => {
  it("muestra a una Secretaria solo la operación diaria", () => {
    expect(
      visiblePanaceaDestinations("secretary").map(
        (destination) => destination.id,
      ),
    ).toEqual(["calendar", "patients", "pending"]);
  });

  it("muestra a un Médico no propietario su capacidad sin administración ajena", () => {
    expect(
      visiblePanaceaDestinations("doctor").map((destination) => destination.id),
    ).toEqual(["calendar", "patients", "pending", "settings"]);
    expect(
      visiblePanaceaConfigurationSections("doctor").map(
        (section) => section.id,
      ),
    ).toEqual(["services", "availability"]);
  });

  it("mantiene Configuración completa para el Médico propietario", () => {
    expect(canAccessPanaceaDestination("owner", "settings")).toBe(true);
    expect(
      visiblePanaceaConfigurationSections("owner").map((section) => section.id),
    ).toEqual(["team", "services", "availability", "whatsapp"]);
  });

  it("no confunde ocultar un destino con autorizarlo", () => {
    expect(canAccessPanaceaDestination("secretary", "settings")).toBe(false);
    expect(canAccessPanaceaDestination("doctor", "settings")).toBe(true);
    expect(canAccessPanaceaConfigurationSection("doctor", "team")).toBe(false);
    expect(canAccessPanaceaConfigurationSection("doctor", "availability")).toBe(
      true,
    );
  });
});
