import { describe, expect, it } from "vitest";

import { whatsappSyntheticSmokeStepCodes } from "~/domain/whatsapp-smoke";
import {
  createSimulatedWhatsAppSyntheticSmokeRunner,
  runPraxiaWhatsAppSyntheticSmoke,
} from "./simulated-whatsapp-smoke";

const input = {
  clinicId: "00000000-0000-0000-0000-000000000092",
  phoneNumberId: "simulated-phone-92",
  projectWebhookId: "simulated-project-92",
  syntheticContactId: "synthetic-smoke:00000000-0000-0000-0000-000000000092",
};

describe("smoke sintético simulado de WhatsApp", () => {
  it("ejecuta los flujos de Praxia, incluido consentimiento y bloqueo legal", async () => {
    const result = await runPraxiaWhatsAppSyntheticSmoke(input);

    expect(result.realPatientsEnabled).toBe(false);
    expect(result.syntheticContact).toBe(true);
    expect(result.steps["consent-pending"]?.passed).toBe(true);
    expect(result.steps["consent-continue"]?.passed).toBe(true);
    expect(result.steps["consent-fallback"]?.passed).toBe(true);
    expect(result.steps["consent-idempotent"]?.passed).toBe(true);
    expect(result.steps["consent-rejection"]?.passed).toBe(true);
    expect(result.steps["consent-version"]?.passed).toBe(true);
    expect(result.steps["adult-flow"]?.passed).toBe(false);
    expect(result.steps["guardian-pending"]?.passed).toBe(false);
    expect(result.steps["adult-flow"]?.message).toContain("APO-93");
    expect(result.steps["guardian-pending"]?.message).toContain("APO-93");
    expect(result.steps["legal-block"]?.passed).toBe(true);
    expect(result.steps["phone-number-created"]?.passed).toBe(true);
    expect(result.steps.redirect?.passed).toBe(true);
    expect(result.steps["batched-webhook"]?.passed).toBe(true);
    expect(result.steps["invalid-signature"]?.passed).toBe(true);
    expect(result.steps["webhook-retry"]?.passed).toBe(true);
    expect(result.steps["webhook-paused"]?.passed).toBe(true);
    expect(result.steps.duplicate?.evidence).toBe("praxia-ingress:duplicate");
    expect(result.steps.duplicate?.message).toContain("persistencia");
  });

  it("ejecuta todos los checks locales y deja evidencia por paso", async () => {
    const result =
      await createSimulatedWhatsAppSyntheticSmokeRunner().run(input);

    expect(Object.keys(result.steps)).toHaveLength(
      whatsappSyntheticSmokeStepCodes.length,
    );
    expect(result.syntheticContact).toBe(true);
    expect(result.providerTransportVerified).toBe(false);
    expect(result.realPatientsEnabled).toBe(false);
    expect(
      Object.values(result.steps).every(
        (step) => step?.evidence !== undefined || step?.message !== undefined,
      ),
    ).toBe(true);
    expect(result.steps["adult-flow"]?.passed).toBe(false);
    expect(result.steps["guardian-pending"]?.passed).toBe(false);
  });
});
