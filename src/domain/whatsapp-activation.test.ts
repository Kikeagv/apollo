import { describe, expect, it } from "vitest";

import {
  evaluateWhatsAppActivationContract,
  validateWhatsAppActivationEvidence,
  whatsappActivationClosureCriteria,
  type WhatsAppActivationContractInput,
  type WhatsAppActivationCriterionCode,
} from "./whatsapp-activation";

const now = new Date("2026-09-16T12:00:00.000Z");

function makeInput(
  overrides: Partial<WhatsAppActivationContractInput> = {},
): WhatsAppActivationContractInput {
  return {
    clinicId: "00000000-0000-0000-0000-000000000094",
    clinicIsSynthetic: false,
    clinicName: "Clínica APO-94",
    connection: {
      connectionType: "coexistence",
      provider: "kapso",
      status: "ready",
    },
    currentProvisioningEventId: "generation-94",
    evidence: [],
    identityStatus: "authenticated",
    ownerAccess: "ready",
    requestedMode: "coexistence",
    smoke: {
      provisioningEventId: "generation-94",
      providerTransportVerified: true,
      realPatientsEnabled: false,
      status: "passed",
      syntheticContact: true,
    },
    technicalReadiness: "ready",
    trafficAllowed: false,
    trafficStatus: "blocked",
    ...overrides,
  };
}

function makeEvidence(
  criterionCode: WhatsAppActivationCriterionCode,
  source: "kapso" | "deployed",
) {
  return {
    criterionCode,
    evidenceReference: `${source}:apo-94:${criterionCode}`,
    provisioningEventId: "generation-94",
    recordedAt: now,
    source,
  } as const;
}

describe("contrato de cierre de Activación de clínica", () => {
  it("mantiene coexistence como v1 y no convierte dedicated en un cierre válido", () => {
    const result = evaluateWhatsAppActivationContract(
      makeInput({ requestedMode: "dedicated" }),
    );

    expect(result.scope).toEqual({
      allowed: false,
      requestedMode: "dedicated",
      status: "requires-approved-extension",
      v1Mode: "coexistence",
    });
    expect(result.states).toEqual({
      connection: "ready",
      identity: "authenticated",
      messaging: "synthetic-only",
      ownerAccess: "ready",
      technicalReadiness: "ready",
    });
    expect(result.gatesRemainEnforced).toBe(true);
  });

  it("separa acceso, conexión, readiness y mensajería habilitada", () => {
    const result = evaluateWhatsAppActivationContract(
      makeInput({
        connection: {
          connectionType: "coexistence",
          provider: "kapso",
          status: "pending",
        },
        ownerAccess: "pending",
        technicalReadiness: "pending",
        trafficAllowed: false,
        trafficStatus: "blocked",
      }),
    );

    expect(result.states).toEqual({
      connection: "pending",
      identity: "authenticated",
      messaging: "blocked",
      ownerAccess: "pending",
      technicalReadiness: "pending",
    });
  });

  it("cierra la matriz solo cuando todas las evidencias externas requeridas están registradas", () => {
    const evidence = whatsappActivationClosureCriteria.flatMap((criterion) =>
      criterion.requiredExternalEvidence.map((source) =>
        makeEvidence(criterion.code, source),
      ),
    );
    const result = evaluateWhatsAppActivationContract(
      makeInput({
        evidence,
        trafficAllowed: true,
        trafficStatus: "enabled",
      }),
    );

    expect(result.scope.status).toBe("v1");
    expect(result.states.messaging).toBe("enabled");
    expect(
      result.criteria.every((criterion) => criterion.status === "verified"),
    ).toBe(true);
    expect(
      result.criteria.find(
        (criterion) => criterion.code === "technical-readiness",
      ),
    ).toMatchObject({
      evidence: {
        kapso: { evidenceReference: "kapso:apo-94:technical-readiness" },
        deployed: { evidenceReference: "deployed:apo-94:technical-readiness" },
      },
      pending: null,
    });
  });

  it("expone el pendiente sin relajar ningún gate cuando falta evidencia", () => {
    const result = evaluateWhatsAppActivationContract(
      makeInput({
        evidence: [makeEvidence("technical-readiness", "kapso")],
      }),
    );
    const criterion = result.criteria.find(
      (candidate) => candidate.code === "technical-readiness",
    );

    expect(criterion).toMatchObject({
      status: "pending",
      pending:
        "Falta evidencia externa de todos los gates técnicos de la generación vigente.",
    });
    expect(result.gatesRemainEnforced).toBe(true);
  });

  it("no presenta mensajería sintética de Kapso si solo existen contratos locales", () => {
    const result = evaluateWhatsAppActivationContract(
      makeInput({
        smoke: {
          provisioningEventId: "generation-94",
          providerTransportVerified: false,
          realPatientsEnabled: false,
          status: "passed",
          syntheticContact: true,
        },
      }),
    );

    expect(result.states.messaging).toBe("blocked");
  });

  it("mantiene pendiente la evidencia de una generación anterior", () => {
    const result = evaluateWhatsAppActivationContract(
      makeInput({
        evidence: [
          {
            ...makeEvidence("technical-readiness", "kapso"),
            provisioningEventId: "generation-old",
          },
        ],
      }),
    );

    expect(
      result.criteria.find(
        (criterion) => criterion.code === "technical-readiness",
      ),
    ).toMatchObject({ status: "pending", evidence: {} });
  });

  it("no cierra la activación si el acceso o la preparación siguen pendientes", () => {
    const evidence = whatsappActivationClosureCriteria.flatMap((criterion) =>
      criterion.requiredExternalEvidence.map((source) =>
        makeEvidence(criterion.code, source),
      ),
    );
    const result = evaluateWhatsAppActivationContract(
      makeInput({
        ownerAccess: "pending",
        technicalReadiness: "pending",
        evidence,
      }),
    );

    expect(result.closureStatus).toBe("pending");
    expect(result.states.messaging).toBe("blocked");
  });

  it("rechaza referencias que contienen secretos o payloads", () => {
    expect(() =>
      // La validación ocurre antes de cualquier sanitización de persistencia.
      validateWhatsAppActivationEvidence({
        criterionCode: "technical-readiness",
        evidenceReference: "Authorization: Bearer secret-value",
        recordedAt: now,
        source: "kapso",
      }),
    ).toThrow("no puede contener secretos");

    expect(() =>
      validateWhatsAppActivationEvidence({
        criterionCode: "technical-readiness",
        pendingReason: "OTP: 1234 recibido por WhatsApp",
        recordedAt: now,
        source: "kapso",
      }),
    ).toThrow("no puede contener secretos");
  });

  it("exige una generación vigente para una evidencia verificada", () => {
    expect(() =>
      validateWhatsAppActivationEvidence({
        criterionCode: "technical-readiness",
        evidenceReference: "kapso-run-apo-94",
        provisioningEventId: null,
        recordedAt: now,
        source: "kapso",
      }),
    ).toThrow("generación vigente");
  });

  it("permite evidencia desplegada en una ruta sin generación de Kapso", () => {
    expect(
      validateWhatsAppActivationEvidence({
        criterionCode: "simulated-connection",
        evidenceReference: "deploy-94-simulated-clinic",
        provisioningEventId: null,
        recordedAt: now,
        source: "deployed",
      }),
    ).toMatchObject({
      evidenceReference: "deploy-94-simulated-clinic",
      provisioningEventId: null,
    });
  });

  it("no cierra con un smoke fallido o de otra generación", () => {
    const evidence = whatsappActivationClosureCriteria.flatMap((criterion) =>
      criterion.requiredExternalEvidence.map((source) =>
        makeEvidence(criterion.code, source),
      ),
    );
    const result = evaluateWhatsAppActivationContract(
      makeInput({
        evidence,
        smoke: {
          provisioningEventId: "generation-old",
          providerTransportVerified: true,
          realPatientsEnabled: false,
          status: "failed",
          syntheticContact: true,
        },
        trafficAllowed: true,
        trafficStatus: "enabled",
      }),
    );

    expect(result.closureStatus).toBe("pending");
    expect(result.states.messaging).toBe("blocked");
  });

  it("no presenta una Conexión retirada como activación pendiente o lista", () => {
    const result = evaluateWhatsAppActivationContract(
      makeInput({ trafficStatus: "offboarded" }),
    );

    expect(result.closureStatus).toBe("blocked");
    expect(result.states.messaging).toBe("offboarded");
  });
});
