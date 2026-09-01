import { describe, expect, it, vi } from "vitest";

import {
  ClinicReadinessNotReadyError,
  ClinicSetupAccessError,
  declareClinicReady,
  getClinicSetup,
  saveClinicSetupStep,
  updateClinicBasics,
  type ClinicSetupBasicsUpdater,
  type ClinicSetupProgressWriter,
  type ClinicSetupReader,
  type ClinicReadinessDeclarer,
} from "./clinic-setup";
import type { ClinicSetupEvaluationInput } from "~/domain/clinic-setup";

const readyEvaluation: ClinicSetupEvaluationInput = {
  availability: { activeSchedules: 1, futureCareOptions: 2 },
  clinic: { asclepioEnabled: false, currentStep: 5, name: "Clínica Aurora" },
  firstValidRoute: {
    doctor: { id: "doctor-1", name: "Dra. Aurora", specialty: "General" },
    firstOptionStartsAt: new Date("2026-09-01T14:00:00.000Z"),
    scheduleEffectiveFrom: "2026-08-01",
    service: {
      durationMinutes: 30,
      id: "service-1",
      name: "Consulta general",
    },
  },
  services: { activeOffers: 1, activeServices: 1 },
  team: { activeDoctors: 1, completedProfiles: 1, pendingInvitations: 0 },
};

describe("caso de uso de Configuración inicial", () => {
  it("devuelve el estado completo de la guía desde un lector autorizado", async () => {
    const read = vi.fn().mockResolvedValue(readyEvaluation);
    const reader: ClinicSetupReader = {
      read,
    };

    const review = await getClinicSetup(
      { clinicId: "clinic-1", identityId: "owner-1" },
      reader,
    );

    expect(review.readiness.status).toBe("ready");
    expect(review.firstValidRoute?.doctor.id).toBe("doctor-1");
    expect(read).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      identityId: "owner-1",
    });
  });

  it("no expone la guía a una membresía sin alcance de configuración", async () => {
    const reader: ClinicSetupReader = {
      read: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      getClinicSetup(
        { clinicId: "clinic-1", identityId: "secretary-1" },
        reader,
      ),
    ).rejects.toBeInstanceOf(ClinicSetupAccessError);
  });

  it("guarda el paso actual y normaliza el avance de la guía", async () => {
    const saveStep = vi.fn().mockResolvedValue(true);
    const writer: ClinicSetupProgressWriter = {
      saveStep,
    };

    await expect(
      saveClinicSetupStep(
        { clinicId: "clinic-1", identityId: "owner-1", step: "services" },
        writer,
      ),
    ).resolves.toBe(true);
    expect(saveStep).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      identityId: "owner-1",
      step: "services",
    });
  });

  it("solo declara lista una Clínica cuando Agenda encontró una ruta válida", async () => {
    const declare = vi.fn().mockResolvedValue(readyEvaluation);
    const declarer: ClinicReadinessDeclarer = {
      declare,
    };

    const review = await declareClinicReady(
      { clinicId: "clinic-1", identityId: "owner-1" },
      declarer,
    );

    expect(review.readiness).toEqual({
      asclepioEnabled: true,
      status: "ready",
    });
    expect(declare).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      identityId: "owner-1",
    });
  });

  it("rechaza la declaración si la última ruta desapareció", async () => {
    const declarer: ClinicReadinessDeclarer = {
      declare: vi.fn().mockResolvedValue({
        ...readyEvaluation,
        clinic: { ...readyEvaluation.clinic, asclepioEnabled: false },
        firstValidRoute: undefined,
      }),
    };

    await expect(
      declareClinicReady(
        { clinicId: "clinic-1", identityId: "owner-1" },
        declarer,
      ),
    ).rejects.toBeInstanceOf(ClinicReadinessNotReadyError);
  });

  it("actualiza el nombre de Clínica con el mismo seam de propietario", async () => {
    const updateBasics = vi.fn().mockResolvedValue({
      ...readyEvaluation,
      clinic: { ...readyEvaluation.clinic, name: "Clínica Nueva" },
    });
    const updater: ClinicSetupBasicsUpdater = {
      updateBasics,
    };

    await expect(
      updateClinicBasics(
        {
          clinicId: "clinic-1",
          identityId: "owner-1",
          name: " Clínica Nueva ",
        },
        updater,
      ),
    ).resolves.toEqual({
      ...readyEvaluation,
      clinic: { ...readyEvaluation.clinic, name: "Clínica Nueva" },
    });
    expect(updateBasics).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      identityId: "owner-1",
      name: "Clínica Nueva",
    });
  });
});
