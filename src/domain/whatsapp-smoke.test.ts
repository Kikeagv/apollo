import { describe, expect, it } from "vitest";

import {
  evaluateWhatsAppSyntheticSmoke,
  expireWhatsAppSyntheticSmoke,
  hasWhatsAppSmokeChallengePrefix,
  isWhatsAppSmokeRunAwaitingInbound,
  isWhatsAppSmokeRunAwaitingReply,
  parseWhatsAppSmokeChallenge,
  parseWhatsAppSmokeReplyIdempotencyKey,
  recordWhatsAppSyntheticSmokeStep,
  whatsappSyntheticSmokeStepCodes,
  whatsappSyntheticSmokeRoundtripStepCodes,
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
  it("reconoce únicamente el código UUID exacto del desafío y la respuesta del smoke", () => {
    const runId = "9ac3c6f1-3e1a-4966-a487-94ee7afbc523";

    expect(hasWhatsAppSmokeChallengePrefix(`PRUEBA WHATSAPP ${runId}`)).toBe(
      true,
    );
    expect(parseWhatsAppSmokeChallenge(` prueba whatsapp ${runId} `)).toBe(
      runId,
    );
    expect(parseWhatsAppSmokeChallenge(`PRUEBA WHATSAPP ${runId} extra`)).toBe(
      null,
    );
    expect(
      parseWhatsAppSmokeReplyIdempotencyKey(`whatsapp-smoke:${runId}:reply`),
    ).toBe(runId);
    expect(
      parseWhatsAppSmokeReplyIdempotencyKey(`whatsapp-smoke:${runId}:other`),
    ).toBe(null);
  });

  it("solo permite la fase que corresponda al estado pendiente del roundtrip", () => {
    const now = new Date("2026-10-01T12:00:00.000Z");
    const baseRun = {
      id: "9ac3c6f1-3e1a-4966-a487-94ee7afbc523",
      provisioningEventId: "generation-92",
      realPatientsEnabled: false,
      requiresRealRoundtrip: true,
      status: "pending" as const,
      steps: [
        {
          code: "real-reception" as const,
          passed: false,
          status: "pending" as const,
        },
        {
          code: "real-processing" as const,
          passed: false,
          status: "pending" as const,
        },
        {
          code: "real-response" as const,
          passed: false,
          status: "pending" as const,
        },
        {
          code: "real-delivery" as const,
          passed: false,
          status: "pending" as const,
        },
      ],
      syntheticContact: false,
      testContactId: "contact-92",
      timeoutAt: new Date(now.valueOf() + 60_000),
    };

    expect(
      isWhatsAppSmokeRunAwaitingInbound({
        now,
        provisioningEventId: "generation-92",
        run: baseRun,
        runId: baseRun.id,
      }),
    ).toBe(true);
    expect(
      isWhatsAppSmokeRunAwaitingInbound({
        now,
        provisioningEventId: "old-generation",
        run: baseRun,
        runId: baseRun.id,
      }),
    ).toBe(false);
    expect(
      isWhatsAppSmokeRunAwaitingInbound({
        now,
        provisioningEventId: "generation-92",
        run: { ...baseRun, timeoutAt: now },
        runId: baseRun.id,
      }),
    ).toBe(false);
    expect(
      isWhatsAppSmokeRunAwaitingInbound({
        now,
        provisioningEventId: "generation-92",
        run: {
          ...baseRun,
          steps: baseRun.steps.map((step) =>
            step.code === "real-reception" ? { ...step, passed: true } : step,
          ),
        },
        runId: baseRun.id,
      }),
    ).toBe(false);

    const awaitingReply = {
      ...baseRun,
      steps: [
        {
          code: "real-reception" as const,
          passed: true,
          status: "passed" as const,
        },
        {
          code: "real-processing" as const,
          passed: true,
          status: "passed" as const,
        },
        {
          code: "real-response" as const,
          passed: false,
          status: "pending" as const,
        },
        {
          code: "real-delivery" as const,
          passed: false,
          status: "pending" as const,
        },
      ],
    };
    expect(
      isWhatsAppSmokeRunAwaitingReply({
        now,
        provisioningEventId: "generation-92",
        run: awaitingReply,
        runId: baseRun.id,
      }),
    ).toBe(true);
    expect(
      isWhatsAppSmokeRunAwaitingReply({
        now,
        provisioningEventId: "generation-92",
        run: baseRun,
        runId: baseRun.id,
      }),
    ).toBe(false);
  });

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

  it("acepta un Contacto controlado pendiente sin llamarlo sintético", () => {
    const steps = passingSteps();
    for (const code of whatsappSyntheticSmokeRoundtripStepCodes) {
      steps[code] = { passed: false, status: "pending" };
    }

    const result = evaluateWhatsAppSyntheticSmoke({
      realPatientsEnabled: false,
      requireRealRoundtrip: true,
      steps,
      syntheticContact: false,
      testContactId: "controlled-contact-92",
    });

    expect(result.status).toBe("pending");
    expect(result.syntheticContact).toBe(false);
    expect(result.controlledTestContact).toBe(true);
    expect(result.blockers).not.toContainEqual(
      expect.objectContaining({ code: "synthetic-contact" }),
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

  it("mantiene pendiente el roundtrip hasta confirmar delivery, no solo accepted", () => {
    const startedAt = new Date("2026-09-25T12:00:00.000Z");
    const steps = passingSteps();
    for (const code of whatsappSyntheticSmokeRoundtripStepCodes) {
      steps[code] = { passed: false, status: "pending" };
    }

    let result = evaluateWhatsAppSyntheticSmoke({
      realPatientsEnabled: false,
      requireRealRoundtrip: true,
      runId: "smoke-run-106",
      steps,
      syntheticContact: true,
      testContactId: "controlled-contact-106",
      timeoutAt: new Date(startedAt.valueOf() + 300_000),
    });

    result = recordWhatsAppSyntheticSmokeStep(result, {
      code: "real-reception",
      eventId: "wamid-inbound-106",
      evidence: "Mensaje entrante recibido",
      observedAt: new Date("2026-09-25T12:00:10.000Z"),
      source: "provider",
      status: "passed",
    });
    result = recordWhatsAppSyntheticSmokeStep(result, {
      code: "real-processing",
      eventId: "wamid-inbound-106",
      evidence: "Mensaje procesado por el worker",
      observedAt: new Date("2026-09-25T12:00:11.000Z"),
      source: "application",
      status: "passed",
    });
    result = recordWhatsAppSyntheticSmokeStep(result, {
      code: "real-response",
      eventId: "wamid-response-106",
      evidence: "Kapso aceptó la respuesta",
      observedAt: new Date("2026-09-25T12:00:12.000Z"),
      source: "provider",
      status: "passed",
    });

    expect(result.status).toBe("pending");
    expect(result.providerTransportVerified).toBe(false);
    expect(
      result.steps.find((step) => step.code === "real-delivery"),
    ).toMatchObject({ status: "pending", passed: false });

    result = recordWhatsAppSyntheticSmokeStep(result, {
      code: "real-delivery",
      eventId: "kapso-delivery-event-106",
      evidence: "Kapso confirmó delivery",
      observedAt: new Date("2026-09-25T12:00:13.000Z"),
      source: "provider",
      status: "passed",
    });

    expect(result.status).toBe("passed");
    expect(result.providerTransportVerified).toBe(true);
    expect(result.runId).toBe("smoke-run-106");
    expect(result.testContactId).toBe("controlled-contact-106");
    expect(result.timeoutAt).toEqual(new Date(startedAt.valueOf() + 300_000));
    expect(
      result.steps.find((step) => step.code === "real-template-delivery"),
    ).toMatchObject({ status: "skipped", passed: false });
  });

  it("registra la entrega de plantilla por intento sobre el smoke real completo", () => {
    const startedAt = new Date("2026-09-25T12:00:00.000Z");
    const steps = passingSteps();
    delete steps["real-template-delivery"];
    for (const code of whatsappSyntheticSmokeRoundtripStepCodes) {
      steps[code] = { passed: false, status: "pending" };
    }
    let result = evaluateWhatsAppSyntheticSmoke({
      realPatientsEnabled: false,
      requireRealRoundtrip: true,
      runId: "smoke-run-template-delivery",
      steps,
      syntheticContact: false,
      testContactId: "controlled-contact-template",
      timeoutAt: new Date(startedAt.valueOf() + 300_000),
    });

    for (const [code, eventId, source] of [
      ["real-reception", "inbound-template", "provider"],
      ["real-processing", "inbound-template", "application"],
      ["real-response", "outbound-template", "provider"],
      ["real-delivery", "delivery-template", "provider"],
    ] as const) {
      result = recordWhatsAppSyntheticSmokeStep(result, {
        code,
        eventId,
        evidence: `${code} observado`,
        observedAt: startedAt,
        source,
        status: "passed",
      });
    }
    expect(result.status).toBe("passed");

    result = recordWhatsAppSyntheticSmokeStep(result, {
      attemptId: "f5d2cc37-646e-4298-a751-b348c4dc0333",
      code: "real-template-delivery",
      eventId: "template-delivery-event",
      evidence: "Kapso confirmó delivery de la plantilla Utility",
      observedAt: new Date(startedAt.valueOf() + 5_000),
      source: "provider",
      status: "passed",
      templateKind: "confirmation",
      templateName: "appointment_confirmation",
    });

    expect(result.status).toBe("passed");
    expect(
      result.steps.find((step) => step.code === "real-template-delivery"),
    ).toMatchObject({
      attemptId: "f5d2cc37-646e-4298-a751-b348c4dc0333",
      passed: true,
      status: "passed",
      templateKind: "confirmation",
      templateName: "appointment_confirmation",
    });
  });

  it("mantiene pendiente el roundtrip si un paso operativo está marcado como no ejecutado", () => {
    const steps = passingSteps();
    for (const code of whatsappSyntheticSmokeRoundtripStepCodes) {
      steps[code] = {
        evidence: `Kapso confirmó ${code}`,
        eventId: `event-${code}`,
        observedAt: new Date("2026-09-25T12:00:00.000Z"),
        passed: true,
        source: code === "real-processing" ? "application" : "provider",
      };
    }
    steps["real-delivery"] = {
      message: "A la espera de la confirmación de entrega",
      passed: false,
      status: "skipped",
    };

    const result = evaluateWhatsAppSyntheticSmoke({
      realPatientsEnabled: false,
      requireRealRoundtrip: true,
      steps,
      syntheticContact: false,
      testContactId: "controlled-contact-skipped-delivery",
      timeoutAt: new Date("2026-09-25T12:05:00.000Z"),
    });

    expect(result.status).toBe("pending");
    expect(result.providerTransportVerified).toBe(false);
    expect(
      result.steps.find((step) => step.code === "real-delivery"),
    ).toMatchObject({ status: "skipped", passed: false });

    const timedOut = expireWhatsAppSyntheticSmoke(
      result,
      new Date("2026-09-25T12:05:00.000Z"),
    );

    expect(timedOut.status).toBe("failed");
    expect(
      timedOut.steps.find((step) => step.code === "real-delivery"),
    ).toMatchObject({ status: "failed" });
    expect(timedOut.blockers).toContainEqual(
      expect.objectContaining({ code: "real-delivery-timeout" }),
    );
  });

  it("separa el preflight y las regresiones no ejecutadas del resultado del roundtrip", () => {
    const steps = {
      ...Object.fromEntries(
        whatsappSyntheticSmokeRoundtripStepCodes.map((code) => [
          code,
          { passed: false, status: "pending" as const },
        ]),
      ),
      "webhook-preflight": {
        evidence: null,
        message: "Kapso no confirmó el preflight",
        passed: false,
        source: "provider" as const,
        status: "failed" as const,
      },
    };

    const result = evaluateWhatsAppSyntheticSmoke({
      realPatientsEnabled: false,
      requireRealRoundtrip: true,
      runId: "smoke-run-preflight-only",
      steps,
      syntheticContact: false,
      testContactId: "controlled-contact-preflight-only",
    });

    expect(result.status).toBe("pending");
    expect(result.providerTransportVerified).toBe(false);
    expect(
      result.steps.find((step) => step.code === "webhook-preflight"),
    ).toMatchObject({ status: "failed", passed: false });
    expect(
      result.steps.find((step) => step.code === "phone-number-created"),
    ).toMatchObject({
      message: "Escenario no ejecutado en el smoke operativo",
      status: "skipped",
      passed: false,
    });
    expect(result.blockers).toEqual([]);
  });

  it("falla al vencer el timeout y conserva evidencia sanitizada por paso", () => {
    const steps = passingSteps();
    for (const code of whatsappSyntheticSmokeRoundtripStepCodes) {
      steps[code] = { passed: false, status: "pending" };
    }
    const result = evaluateWhatsAppSyntheticSmoke({
      realPatientsEnabled: false,
      requireRealRoundtrip: true,
      runId: "smoke-run-timeout",
      steps,
      syntheticContact: true,
      testContactId: "controlled-contact-timeout",
      timeoutAt: new Date("2026-09-25T12:05:00.000Z"),
    });

    const observed = recordWhatsAppSyntheticSmokeStep(result, {
      code: "real-reception",
      eventId: "wamid-inbound-timeout",
      evidence: "password=private-value",
      observedAt: new Date("2026-09-25T12:00:02.000Z"),
      source: "provider",
      status: "passed",
    });
    const timedOut = expireWhatsAppSyntheticSmoke(
      observed,
      new Date("2026-09-25T12:05:00.000Z"),
    );

    expect(timedOut.status).toBe("failed");
    expect(timedOut.providerTransportVerified).toBe(false);
    expect(
      timedOut.steps.find((step) => step.code === "real-reception"),
    ).toMatchObject({
      eventId: "wamid-inbound-timeout",
      evidence: "password=[redacted]",
      observedAt: new Date("2026-09-25T12:00:02.000Z"),
      status: "passed",
    });
    expect(
      timedOut.steps.find((step) => step.code === "real-delivery"),
    ).toMatchObject({
      message: "El Contacto no completó este paso antes del timeout",
      observedAt: new Date("2026-09-25T12:05:00.000Z"),
      status: "failed",
    });
    expect(timedOut.timedOutAt).toEqual(new Date("2026-09-25T12:05:00.000Z"));
  });

  it("falla si Kapso reporta delivery fallido aunque la respuesta fuera aceptada", () => {
    const startedAt = new Date("2026-09-25T12:00:00.000Z");
    const steps = passingSteps();
    for (const code of whatsappSyntheticSmokeRoundtripStepCodes) {
      steps[code] = { passed: false, status: "pending" };
    }
    let result = evaluateWhatsAppSyntheticSmoke({
      realPatientsEnabled: false,
      requireRealRoundtrip: true,
      runId: "smoke-run-delivery-failed",
      steps,
      syntheticContact: true,
      testContactId: "controlled-contact-delivery-failed",
      timeoutAt: new Date(startedAt.valueOf() + 300_000),
    });
    for (const [code, eventId, source] of [
      ["real-reception", "inbound-106", "provider"],
      ["real-processing", "inbound-106", "application"],
      ["real-response", "outbound-106", "provider"],
    ] as const) {
      result = recordWhatsAppSyntheticSmokeStep(result, {
        code,
        eventId,
        evidence: `${code} observado`,
        observedAt: startedAt,
        source,
        status: "passed",
      });
    }
    result = recordWhatsAppSyntheticSmokeStep(result, {
      code: "real-delivery",
      eventId: "delivery-failed-106",
      evidence: "Kapso confirmó un fallo de entrega",
      message: "Kapso confirmó un fallo de entrega",
      observedAt: new Date(startedAt.valueOf() + 5_000),
      source: "provider",
      status: "failed",
    });

    expect(result.status).toBe("failed");
    expect(result.providerTransportVerified).toBe(false);
    expect(
      result.steps.find((step) => step.code === "real-response"),
    ).toMatchObject({
      status: "passed",
      passed: true,
    });
    expect(
      result.steps.find((step) => step.code === "real-delivery"),
    ).toMatchObject({
      status: "failed",
      passed: false,
    });
  });
});
