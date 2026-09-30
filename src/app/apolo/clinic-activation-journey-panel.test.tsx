import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  whatsappSyntheticSmokeRoundtripStepCodes,
  whatsappSyntheticSmokeStepCodes,
} from "~/domain/whatsapp-smoke";
import type { WhatsAppOperationsSmokeRun } from "~/server/application/whatsapp-operations";
import { ClinicActivationJourneyPanel } from "./clinic-activation-journey-panel";

const observedAt = new Date("2026-09-30T12:00:00.000Z");

function makeSmokeRun(): WhatsAppOperationsSmokeRun {
  return {
    blockers: [],
    controlledTestContact: true,
    evidence: "Roundtrip de Contacto controlado",
    finishedAt: observedAt,
    id: "roundtrip-run-115",
    provisioningEventId: "generation-115",
    providerTransportVerified: true,
    realPatientsEnabled: false,
    requireRealRoundtrip: true,
    runId: "roundtrip-run-115",
    startedAt: observedAt,
    status: "passed",
    steps: whatsappSyntheticSmokeStepCodes.map((code) => {
      const roundtripStep = (
        whatsappSyntheticSmokeRoundtripStepCodes as readonly string[]
      ).includes(code);
      return {
        code,
        evidence: roundtripStep ? `Evidencia ${code}` : null,
        eventId: roundtripStep ? `event-${code}` : null,
        message: roundtripStep
          ? null
          : "Escenario no ejecutado en el smoke operativo",
        observedAt: roundtripStep ? observedAt : null,
        passed: roundtripStep,
        source:
          code === "real-processing"
            ? "application"
            : roundtripStep || code === "webhook-preflight"
              ? "provider"
              : null,
        status: roundtripStep
          ? "passed"
          : code === "webhook-preflight"
            ? "failed"
            : "skipped",
      };
    }),
    syntheticContact: false,
    testContactId: "controlled-contact-115",
    testContactMaskedPhone: "+••••••0115",
    timeoutAt: observedAt,
    timedOutAt: null,
  };
}

function renderPanel(
  latestSmoke: WhatsAppOperationsSmokeRun,
  currentProvisioningEventId: string,
) {
  return renderToStaticMarkup(
    createElement(ClinicActivationJourneyPanel, {
      clinicId: "clinic-115",
      currentProvisioningEventId,
      instanceId: "whatsapp",
      isLoading: false,
      isSending: false,
      isKapso: true,
      isRunningSmoke: false,
      isCreatingTestContact: false,
      isSendingTemplateTest: false,
      latestSmoke,
      numberHealth: "healthy",
      numberHealthCheckedAt: observedAt,
      approvedTemplateKind: "confirmation",
      onCreateTestContact: () => undefined,
      onRegister: () => undefined,
      onRunSmoke: () => undefined,
      onRunTemplateTest: () => undefined,
      onSendSetupLink: () => undefined,
      onSmokeTestPhoneChange: () => undefined,
      onboarding: null,
      registration: null,
      sendError: null,
      sendMessage: null,
      sendStatus: null,
      templateTestError: null,
      templateTestMessage: null,
      realTrafficStatus: "blocked",
      smokeTestPhone: "+50370000000",
      smokeError: null,
      createContactError: null,
      createdTestContactMessage: null,
    }),
  );
}

describe("panel del recorrido de Activación de WhatsApp", () => {
  it("muestra las cuatro evidencias y mantiene el preflight separado del paso 3", () => {
    const html = renderPanel(makeSmokeRun(), "generation-115");

    expect(html).toContain("Probar recepción y respuesta de la Clínica");
    expect(html).toContain("Probar conversación con plantilla");
    expect(html).toContain("Enviar enlace al propietario");
    expect(html).toContain("Completo");
    expect(html).toContain("Recepción del mensaje del Contacto");
    expect(html).toContain("Procesamiento del mensaje entrante");
    expect(html).toContain("Respuesta administrativa aceptada");
    expect(html).toContain("Delivery confirmado del asistente de la clínica");
    expect(html).toContain("Preflight del webhook");
    expect(html).toContain("falló");
    expect(html).toContain("+••••••0115");
    expect(html).toContain("La Clínica no se marca lista para tráfico real");
    expect(html).not.toContain("Completa la verificación previa de WhatsApp");
  });

  it("no reutiliza evidencia de una generación anterior de la Conexión", () => {
    const smoke = makeSmokeRun();
    smoke.provisioningEventId = "generation-old";

    const html = renderPanel(smoke, "generation-115");

    expect(html).toContain("Pendiente de la prueba real");
    expect(html).not.toContain("Roundtrip entregado al Contacto controlado");
    expect(html).not.toContain("roundtrip-run-115");
  });
});
