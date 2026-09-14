import { describe, expect, it } from "vitest";

import {
  evaluateWhatsAppSyntheticSmoke,
  whatsappSyntheticSmokeStepCodes,
  type WhatsAppSyntheticSmokeStepCode,
  type WhatsAppSyntheticSmokeStepInput,
} from "./whatsapp-smoke";

function passingSteps(): Partial<
  Record<WhatsAppSyntheticSmokeStepCode, WhatsAppSyntheticSmokeStepInput>
> {
  return Object.fromEntries(
    whatsappSyntheticSmokeStepCodes.map((code) => [
      code,
      { evidence: `synthetic:${code}`, passed: true },
    ]),
  );
}

describe("smoke sintético de WhatsApp", () => {
  it("exige todos los pasos, conserva evidencia sintética y nunca habilita pacientes reales", () => {
    const result = evaluateWhatsAppSyntheticSmoke({
      realPatientsEnabled: false,
      steps: passingSteps(),
      syntheticContact: true,
    });

    expect(result.status).toBe("passed");
    expect(result.realPatientsEnabled).toBe(false);
    expect(result.steps).toHaveLength(whatsappSyntheticSmokeStepCodes.length);
    expect(
      result.steps.find((step) => step.code === "history-sync"),
    ).toMatchObject({
      passed: true,
    });
  });

  it("falla si falta un paso o el runner reporta un contacto real", () => {
    const steps = passingSteps();
    delete steps["delivery-status"];

    const result = evaluateWhatsAppSyntheticSmoke({
      realPatientsEnabled: true,
      steps,
      syntheticContact: false,
    });

    expect(result.status).toBe("failed");
    expect(result.realPatientsEnabled).toBe(true);
    expect(result.syntheticContact).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "delivery-status" }),
        expect.objectContaining({ code: "synthetic-contact" }),
        expect.objectContaining({ code: "real-patients" }),
      ]),
    );
  });

  it("falla cerrado si un paso aprobado no trae evidencia operativa", () => {
    const steps = passingSteps();
    steps.connection = { passed: true };

    const result = evaluateWhatsAppSyntheticSmoke({
      realPatientsEnabled: false,
      steps,
      syntheticContact: true,
    });

    expect(result.status).toBe("failed");
    expect(
      result.steps.find((step) => step.code === "connection"),
    ).toMatchObject({ passed: false });
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ code: "connection-evidence" }),
    );
  });

  it("redacta secretos también dentro de pasos y bloqueos", () => {
    const steps = passingSteps();
    steps.connection = {
      evidence: "Authorization: Bearer top-secret",
      message: "password=super-secret",
      passed: false,
    };

    const result = evaluateWhatsAppSyntheticSmoke({
      evidence: "api_key=top-secret",
      realPatientsEnabled: false,
      steps,
      syntheticContact: true,
    });

    expect(result.evidence).toBe("api_key=[redacted]");
    expect(
      result.steps.find((step) => step.code === "connection"),
    ).toMatchObject({
      evidence: "Authorization: [redacted]",
      message: "password=[redacted]",
    });
    expect(result.blockers[0]?.message).toBe("password=[redacted]");
  });
});
