import { describe, expect, it } from "vitest";

import {
  buildClinicSetupReview,
  CLINIC_TERMS_ACCEPTANCE_ERROR_MESSAGE,
  CLINIC_TERMS_VERSION,
  createCurrentClinicTermsAcceptance,
  isCurrentClinicTermsAcceptance,
  requireCurrentClinicTermsAcceptance,
  type ClinicSetupEvaluationInput,
} from "./clinic-setup";

const initialConfiguration: ClinicSetupEvaluationInput = {
  availability: {
    activeSchedules: 1,
    futureCareOptions: 0,
  },
  clinic: {
    asclepioEnabled: false,
    currentStep: 4,
    name: "Clínica Aurora",
  },
  firstValidRoute: undefined,
  services: {
    activeOffers: 0,
    activeServices: 1,
  },
  termsAcceptance: { acceptedAt: null, version: null },
  team: {
    activeDoctors: 2,
    completedProfiles: 1,
    pendingInvitations: 1,
  },
};

describe("guía de Configuración inicial de Clínica", () => {
  it("usa una aceptación versionada como contrato canónico de declaración", () => {
    expect(createCurrentClinicTermsAcceptance()).toEqual({
      version: CLINIC_TERMS_VERSION,
    });
    expect(
      requireCurrentClinicTermsAcceptance({ version: CLINIC_TERMS_VERSION }),
    ).toEqual({ version: CLINIC_TERMS_VERSION });
  });

  it.each([
    ["faltante", undefined],
    ["desactualizada", { version: "0.9" }],
  ])("rechaza una aceptación %s con el mismo mensaje", (_label, acceptance) => {
    expect(() => requireCurrentClinicTermsAcceptance(acceptance)).toThrow(
      CLINIC_TERMS_ACCEPTANCE_ERROR_MESSAGE,
    );
  });

  it("considera vigente solo una aceptación persistida con fecha y versión actuales", () => {
    expect(
      isCurrentClinicTermsAcceptance({
        acceptedAt: new Date("2026-09-01T12:00:00.000Z"),
        version: CLINIC_TERMS_VERSION,
      }),
    ).toBe(true);
    expect(
      isCurrentClinicTermsAcceptance({
        acceptedAt: new Date("2026-09-01T12:00:00.000Z"),
        version: "0.9",
      }),
    ).toBe(false);
  });

  it("conserva la habilitación histórica mientras la aceptación se regulariza", () => {
    const review = buildClinicSetupReview({
      ...initialConfiguration,
      availability: { activeSchedules: 1, futureCareOptions: 2 },
      clinic: { ...initialConfiguration.clinic, asclepioEnabled: true },
      firstValidRoute: {
        doctor: {
          id: "doctor-1",
          name: "Dra. Aurora",
          specialty: "Medicina general",
        },
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
    });

    expect(review.readiness).toEqual({
      asclepioEnabled: true,
      status: "ready",
    });
    expect(review.termsAcceptance.accepted).toBe(false);
    expect(review.canDeclareReady).toBe(false);
  });

  it("expone el paso actual, los pasos pendientes y los bloqueadores sin ocultar configuración parcial", () => {
    const review = buildClinicSetupReview(initialConfiguration);

    expect(review.currentStep).toBe("availability");
    expect(review.progress).toEqual({ completed: 2, total: 5 });
    expect(review.readiness).toEqual({
      asclepioEnabled: false,
      status: "pending",
    });
    expect(review.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "clinic", state: "complete" }),
        expect.objectContaining({ id: "team", state: "complete" }),
        expect.objectContaining({ id: "services", state: "pending" }),
        expect.objectContaining({ id: "availability", state: "current" }),
        expect.objectContaining({ id: "review", state: "pending" }),
      ]),
    );
    expect(review.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "services" }),
        expect.objectContaining({ code: "availability" }),
      ]),
    );
    expect(review.partialConfiguration).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "pending-invitations", count: 1 }),
        expect.objectContaining({ code: "incomplete-team", count: 1 }),
      ]),
    );
  });

  it("mantiene como actual el paso guardado aunque sus datos ya estén completos", () => {
    const review = buildClinicSetupReview({
      ...initialConfiguration,
      clinic: { ...initialConfiguration.clinic, currentStep: 1 },
      team: { ...initialConfiguration.team, completedProfiles: 0 },
    });

    expect(review.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "clinic", state: "current" }),
        expect.objectContaining({ id: "team", state: "pending" }),
      ]),
    );
  });

  it("considera lista una Clínica con la primera ruta válida aunque existan extras incompletos", () => {
    const review = buildClinicSetupReview({
      availability: { activeSchedules: 2, futureCareOptions: 4 },
      clinic: {
        asclepioEnabled: false,
        currentStep: 5,
        name: "Clínica Aurora",
      },
      firstValidRoute: {
        doctor: {
          id: "doctor-1",
          name: "Dra. Aurora",
          specialty: "Medicina general",
        },
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
        version: "1.0",
      },
      team: { activeDoctors: 3, completedProfiles: 1, pendingInvitations: 1 },
    });

    expect(review.readiness).toEqual({
      asclepioEnabled: false,
      status: "ready",
    });
    expect(review.canDeclareReady).toBe(true);
    expect(review.termsAcceptance).toEqual({
      accepted: true,
      acceptedAt: new Date("2026-09-01T12:00:00.000Z"),
      currentVersion: "1.0",
      version: "1.0",
    });
    expect(review.progress).toEqual({ completed: 5, total: 5 });
    expect(review.firstValidRoute?.doctor.name).toBe("Dra. Aurora");
    expect(review.firstValidRoute?.service.name).toBe("Consulta general");
    expect(review.partialConfiguration).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "pending-invitations" }),
        expect.objectContaining({ code: "incomplete-team" }),
      ]),
    );
    expect(review.blockers).toEqual([]);
  });

  it("mantiene Asclepio deshabilitado cuando se pierde la última ruta", () => {
    const review = buildClinicSetupReview({
      ...initialConfiguration,
      clinic: {
        asclepioEnabled: true,
        currentStep: 5,
        name: "Clínica Aurora",
      },
      firstValidRoute: undefined,
      services: { activeOffers: 1, activeServices: 1 },
      team: { activeDoctors: 1, completedProfiles: 1, pendingInvitations: 0 },
    });

    expect(review.readiness).toEqual({
      asclepioEnabled: false,
      status: "pending",
    });
    expect(review.canDeclareReady).toBe(false);
    expect(review.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "availability" }),
      ]),
    );
  });

  it("mantiene pendiente la declaración hasta registrar la aceptación vigente", () => {
    const review = buildClinicSetupReview({
      ...initialConfiguration,
      availability: { activeSchedules: 1, futureCareOptions: 2 },
      clinic: { ...initialConfiguration.clinic, currentStep: 5 },
      firstValidRoute: {
        doctor: {
          id: "doctor-1",
          name: "Dra. Aurora",
          specialty: "Medicina general",
        },
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
    });

    expect(review.readiness.status).toBe("ready");
    expect(review.termsAcceptance.accepted).toBe(false);
    expect(review.canDeclareReady).toBe(false);
  });
});
