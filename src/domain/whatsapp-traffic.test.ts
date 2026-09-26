import { describe, expect, it } from "vitest";

import {
  evaluateWhatsAppRealTraffic,
  whatsappRealTrafficGateCodes,
  type WhatsAppRealTrafficGateCode,
} from "./whatsapp-traffic";

function readyGates(): Record<
  WhatsAppRealTrafficGateCode,
  { evidenceReference: string | null; ready: boolean }
> {
  return Object.fromEntries(
    whatsappRealTrafficGateCodes.map((code) => [
      code,
      { evidenceReference: `evidence:${code}`, ready: true },
    ]),
  ) as Record<
    WhatsAppRealTrafficGateCode,
    { evidenceReference: string | null; ready: boolean }
  >;
}

describe("gate de tráfico real de WhatsApp", () => {
  it("permite habilitar solo con todos los gates, readiness y smoke sintético", () => {
    const result = evaluateWhatsAppRealTraffic({
      circuitStatus: "closed",
      clinicIsSynthetic: false,
      connectionGenerationId: "generation-current",
      connectionProvider: "kapso",
      connectionStatus: "ready",
      gates: readyGates(),
      smoke: {
        providerTransportVerified: true,
        provisioningEventId: "generation-current",
        realPatientsEnabled: false,
        status: "passed",
        syntheticContact: true,
      },
      technicalReadiness: "ready",
      trafficStatus: "blocked",
    });

    expect(result.allowed).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("permite un roundtrip aprobado por Contacto controlado sin clasificarlo sintético", () => {
    const result = evaluateWhatsAppRealTraffic({
      circuitStatus: "closed",
      clinicIsSynthetic: false,
      connectionGenerationId: "generation-current",
      connectionProvider: "kapso",
      connectionStatus: "ready",
      gates: readyGates(),
      smoke: {
        controlledTestContact: true,
        providerTransportVerified: true,
        provisioningEventId: "generation-current",
        realPatientsEnabled: false,
        status: "passed",
        syntheticContact: false,
      },
      technicalReadiness: "ready",
      trafficStatus: "blocked",
    });

    expect(result.allowed).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("exige habilitación manual cuando se usa como guard de envío", () => {
    const blocked = evaluateWhatsAppRealTraffic({
      circuitStatus: "closed",
      clinicIsSynthetic: false,
      connectionGenerationId: "generation-current",
      connectionProvider: "kapso",
      connectionStatus: "ready",
      gates: readyGates(),
      requireEnabled: true,
      smoke: {
        providerTransportVerified: true,
        provisioningEventId: "generation-current",
        realPatientsEnabled: false,
        status: "passed",
        syntheticContact: true,
      },
      technicalReadiness: "ready",
      trafficStatus: "blocked",
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.blockers).toContainEqual(
      expect.objectContaining({ code: "traffic-not-enabled" }),
    );

    const enabled = evaluateWhatsAppRealTraffic({
      circuitStatus: "closed",
      clinicIsSynthetic: false,
      connectionGenerationId: "generation-current",
      connectionProvider: "kapso",
      connectionStatus: "ready",
      gates: readyGates(),
      requireEnabled: true,
      smoke: {
        providerTransportVerified: true,
        provisioningEventId: "generation-current",
        realPatientsEnabled: false,
        status: "passed",
        syntheticContact: true,
      },
      technicalReadiness: "ready",
      trafficStatus: "enabled",
    });

    expect(enabled.allowed).toBe(true);
  });

  it("bloquea Kapso si el smoke no conserva verificación externa durable", () => {
    const result = evaluateWhatsAppRealTraffic({
      circuitStatus: "closed",
      clinicIsSynthetic: false,
      connectionGenerationId: "generation-current",
      connectionProvider: "kapso",
      connectionStatus: "ready",
      gates: readyGates(),
      requireEnabled: true,
      smoke: {
        provisioningEventId: "generation-current",
        providerTransportVerified: false,
        realPatientsEnabled: false,
        status: "passed",
        syntheticContact: true,
      },
      technicalReadiness: "ready",
      trafficStatus: "enabled",
    });

    expect(result.allowed).toBe(false);
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ code: "provider-transport-unverified" }),
    );
  });

  it("bloquea consentimiento incompleto, billing no adjunto, sandbox, smoke fallido y circuito abierto", () => {
    const gates = readyGates();
    gates.consent = { evidenceReference: null, ready: false };
    gates.billing = { evidenceReference: null, ready: false };

    const result = evaluateWhatsAppRealTraffic({
      circuitStatus: "open",
      clinicIsSynthetic: false,
      connectionGenerationId: "generation-current",
      connectionStatus: "ready",
      gates,
      smoke: {
        provisioningEventId: "generation-current",
        realPatientsEnabled: false,
        status: "failed",
        syntheticContact: true,
      },
      technicalReadiness: "blocked",
      technicalBlockers: ["Número sandbox", "Plantilla PENDING"],
      trafficStatus: "blocked",
    });

    expect(result.allowed).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "consent" }),
        expect.objectContaining({ code: "billing" }),
        expect.objectContaining({ code: "technical-readiness" }),
        expect.objectContaining({ code: "smoke" }),
        expect.objectContaining({ code: "circuit-breaker" }),
      ]),
    );
  });

  it("no reabre una Conexión retirada", () => {
    const result = evaluateWhatsAppRealTraffic({
      circuitStatus: "closed",
      clinicIsSynthetic: false,
      connectionGenerationId: "generation-current",
      connectionStatus: "disconnected",
      gates: readyGates(),
      smoke: {
        provisioningEventId: "generation-current",
        realPatientsEnabled: false,
        status: "passed",
        syntheticContact: true,
      },
      technicalReadiness: "ready",
      trafficStatus: "offboarded",
    });

    expect(result.allowed).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "offboarded" }),
        expect.objectContaining({ code: "connection" }),
      ]),
    );
  });

  it("no reutiliza el smoke de una generación anterior de Kapso", () => {
    const result = evaluateWhatsAppRealTraffic({
      circuitStatus: "closed",
      clinicIsSynthetic: false,
      connectionGenerationId: "generation-current",
      connectionStatus: "ready",
      gates: readyGates(),
      smoke: {
        provisioningEventId: "generation-previous",
        realPatientsEnabled: false,
        status: "passed",
        syntheticContact: true,
      },
      technicalReadiness: "ready",
      trafficStatus: "blocked",
    });

    expect(result.allowed).toBe(false);
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ code: "smoke-generation" }),
    );
  });

  it("bloquea si la Conexión no tiene generación verificable", () => {
    const result = evaluateWhatsAppRealTraffic({
      circuitStatus: "closed",
      clinicIsSynthetic: false,
      connectionGenerationId: null,
      connectionStatus: "ready",
      gates: readyGates(),
      smoke: {
        provisioningEventId: null,
        realPatientsEnabled: false,
        status: "passed",
        syntheticContact: true,
      },
      technicalReadiness: "ready",
      trafficStatus: "blocked",
    });

    expect(result.allowed).toBe(false);
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ code: "smoke-generation" }),
    );
  });
});
