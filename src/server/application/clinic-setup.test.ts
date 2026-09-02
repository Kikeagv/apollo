import { describe, expect, it, vi } from "vitest";

import {
  ClinicReadinessNotReadyError,
  ClinicSetupAccessError,
  declareClinicReady,
  getClinicSetup,
  saveClinicSetupStep,
  updateClinicBasics,
  ClinicTermsNotAcceptedError,
  type ClinicSetupBasicsUpdater,
  type ClinicSetupProgressWriter,
  type ClinicSetupReader,
  type ClinicReadinessDeclarer,
} from "./clinic-setup";
import {
  CLINIC_TERMS_ACCEPTANCE_ERROR_MESSAGE,
  CLINIC_TERMS_VERSION,
  type ClinicSetupEvaluationInput,
} from "~/domain/clinic-setup";

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
  termsAcceptance: {
    acceptedAt: new Date("2026-09-01T12:00:00.000Z"),
    version: CLINIC_TERMS_VERSION,
  },
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
      {
        clinicId: "clinic-1",
        identityId: "owner-1",
        termsAcceptance: { version: CLINIC_TERMS_VERSION },
      },
      declarer,
    );

    expect(review.readiness).toEqual({
      asclepioEnabled: true,
      status: "ready",
    });
    expect(declare).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      identityId: "owner-1",
      termsAcceptance: { version: CLINIC_TERMS_VERSION },
    });
  });

  it.each([
    ["faltante", undefined],
    ["desactualizada", { version: "0.9" }],
  ])(
    "rechaza una aceptación %s antes de declarar lista la Clínica con un único mensaje",
    async (_label, termsAcceptance) => {
      const declare = vi.fn();
      const declarer: ClinicReadinessDeclarer = { declare };

      await expect(
        declareClinicReady(
          {
            clinicId: "clinic-1",
            identityId: "owner-1",
            termsAcceptance,
          },
          declarer,
        ),
      ).rejects.toMatchObject({
        message: CLINIC_TERMS_ACCEPTANCE_ERROR_MESSAGE,
        name: ClinicTermsNotAcceptedError.name,
      });
      expect(declare).not.toHaveBeenCalled();
    },
  );

  it("rechaza una aceptación desactualizada aunque un adaptador devuelva una evaluación positiva", async () => {
    const declarer: ClinicReadinessDeclarer = {
      declare: vi.fn().mockResolvedValue({
        ...readyEvaluation,
        termsAcceptance: {
          acceptedAt: readyEvaluation.termsAcceptance.acceptedAt,
          version: "0.9",
        },
      }),
    };

    await expect(
      declareClinicReady(
        {
          clinicId: "clinic-1",
          identityId: "owner-1",
          termsAcceptance: { version: CLINIC_TERMS_VERSION },
        },
        declarer,
      ),
    ).rejects.toBeInstanceOf(ClinicTermsNotAcceptedError);
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
        {
          clinicId: "clinic-1",
          identityId: "owner-1",
          termsAcceptance: { version: CLINIC_TERMS_VERSION },
        },
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
