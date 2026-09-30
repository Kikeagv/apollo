import { describe, expect, it } from "vitest";

import { buildClinicActivationJourney } from "./clinic-activation-journey";

const evidenceDate = new Date("2026-09-28T12:00:00.000Z");

describe("recorrido de Activación de WhatsApp", () => {
  it("separa alta, salud operativa y pruebas de transporte", () => {
    const journey = buildClinicActivationJourney({
      clinicRegistered: true,
      ownerAssociated: true,
      providerHealth: "healthy",
      providerHealthCheckedAt: evidenceDate,
      setupLinkCreatedAt: evidenceDate,
      setupLinkDelivery: null,
      setupLinkId: "link-1",
      setupLinkStatus: "active",
      now: evidenceDate,
    });

    expect(journey.enrollmentProgress).toBe("in-progress");
    expect(journey.providerHealth).toMatchObject({
      checkedAt: evidenceDate,
      status: "healthy",
    });
    expect(journey.steps).toMatchObject([
      { id: "clinic-registration", status: "completed" },
      { id: "setup-link", status: "pending" },
      { id: "inbound-roundtrip", status: "pending", updatedAt: null },
      { id: "template-delivery", status: "pending", updatedAt: null },
    ]);
    expect(journey.realTrafficReady).toBe(false);
  });

  it("confirma el segundo paso solo cuando el enlace se entregó al propietario", () => {
    const journey = buildClinicActivationJourney({
      clinicRegistered: true,
      ownerAssociated: true,
      providerHealth: "unknown",
      providerHealthCheckedAt: null,
      setupLinkCreatedAt: evidenceDate,
      setupLinkDelivery: {
        occurredAt: evidenceDate,
        result: "succeeded",
        setupLinkId: "link-1",
      },
      setupLinkId: "link-1",
      setupLinkStatus: "active",
      now: evidenceDate,
    });

    expect(journey.steps[1]).toMatchObject({
      id: "setup-link",
      status: "completed",
      updatedAt: evidenceDate,
    });
    expect(journey.enrollmentProgress).toBe("in-progress");
    expect(journey.providerHealth.status).toBe("unverified");
  });

  it("reporta el fallo de entrega sin convertirlo en una caída del proveedor", () => {
    const journey = buildClinicActivationJourney({
      clinicRegistered: true,
      ownerAssociated: true,
      providerHealth: "unknown",
      providerHealthCheckedAt: null,
      setupLinkCreatedAt: evidenceDate,
      setupLinkDelivery: {
        occurredAt: evidenceDate,
        result: "failed",
        setupLinkId: "link-1",
      },
      setupLinkId: "link-1",
      setupLinkStatus: "active",
      now: evidenceDate,
    });

    expect(journey.steps[1]).toMatchObject({ status: "failed" });
    expect(journey.providerHealth.status).toBe("unverified");
  });

  it("distingue un error confirmado del proveedor de una verificación pendiente", () => {
    const journey = buildClinicActivationJourney({
      clinicRegistered: true,
      ownerAssociated: true,
      providerHealth: "error",
      providerHealthCheckedAt: evidenceDate,
      setupLinkCreatedAt: null,
      setupLinkDelivery: null,
      setupLinkId: null,
      setupLinkStatus: null,
      now: evidenceDate,
    });

    expect(journey.providerHealth.status).toBe("issue");
  });

  it("no muestra como saludable una evidencia de salud vencida", () => {
    const journey = buildClinicActivationJourney({
      clinicRegistered: true,
      ownerAssociated: true,
      providerHealth: "healthy",
      providerHealthCheckedAt: new Date("2026-09-28T11:00:00.000Z"),
      setupLinkCreatedAt: null,
      setupLinkDelivery: null,
      setupLinkId: null,
      setupLinkStatus: null,
      now: evidenceDate,
    });

    expect(journey.providerHealth).toMatchObject({
      checkedAt: new Date("2026-09-28T11:00:00.000Z"),
      status: "unverified",
    });
  });

  it("considera terminado el enrolamiento tras usar el enlace", () => {
    const journey = buildClinicActivationJourney({
      clinicRegistered: true,
      ownerAssociated: true,
      providerHealth: "limited",
      providerHealthCheckedAt: evidenceDate,
      setupLinkCreatedAt: evidenceDate,
      setupLinkDelivery: {
        occurredAt: evidenceDate,
        result: "succeeded",
        setupLinkId: "link-1",
      },
      setupLinkId: "link-1",
      setupLinkStatus: "used",
      now: evidenceDate,
    });

    expect(journey.enrollmentProgress).toBe("completed");
    expect(journey.realTrafficReady).toBe(false);
  });
});
