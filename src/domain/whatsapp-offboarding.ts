export const whatsappOffboardingStepCodes = [
  "stop-sends",
  "disconnect-connection",
  "disable-project-webhook",
  "disable-phone-webhook",
  "revoke-setup-links",
  "export-configuration",
] as const;

export type WhatsAppOffboardingStepCode =
  (typeof whatsappOffboardingStepCodes)[number];

export type WhatsAppOffboardingStep = {
  code: WhatsAppOffboardingStepCode;
  effect: "already-complete" | "changed";
  status: "failed" | "succeeded";
};

export function whatsappOffboardingStepOutcome(input: {
  alreadyComplete: boolean;
  code: WhatsAppOffboardingStepCode;
}): WhatsAppOffboardingStep {
  return {
    code: input.code,
    effect: input.alreadyComplete ? "already-complete" : "changed",
    status: "succeeded",
  };
}

export function isWhatsAppOffboardingComplete(
  steps: WhatsAppOffboardingStep[],
) {
  return whatsappOffboardingStepCodes.every((code) =>
    steps.some((step) => step.code === code && step.status === "succeeded"),
  );
}
