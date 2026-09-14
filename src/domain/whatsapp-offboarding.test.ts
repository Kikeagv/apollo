import { describe, expect, it } from "vitest";

import {
  isWhatsAppOffboardingComplete,
  whatsappOffboardingStepCodes,
  whatsappOffboardingStepOutcome,
} from "./whatsapp-offboarding";

describe("offboarding de WhatsApp", () => {
  it("trata un paso ya aplicado como éxito idempotente", () => {
    expect(
      whatsappOffboardingStepOutcome({
        alreadyComplete: true,
        code: "disable-project-webhook",
      }),
    ).toEqual({
      code: "disable-project-webhook",
      effect: "already-complete",
      status: "succeeded",
    });
  });

  it("solo queda completo cuando todos los pasos fueron evidenciados", () => {
    const steps = whatsappOffboardingStepCodes.map((code) => ({
      code,
      effect: "changed" as const,
      status: "succeeded" as const,
    }));

    expect(isWhatsAppOffboardingComplete(steps)).toBe(true);
    expect(
      isWhatsAppOffboardingComplete(
        steps.map((step, index) =>
          index === 0 ? { ...step, status: "failed" as const } : step,
        ),
      ),
    ).toBe(false);
  });
});
