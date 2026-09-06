export const whatsappProviders = ["simulated", "kapso"] as const;

export type WhatsAppProviderId = (typeof whatsappProviders)[number];

type SecretStatus = "configured" | "not-configured" | "not-required";

export type WhatsAppRuntimeDiagnostic = {
  apiKey: SecretStatus;
  configured: boolean;
  missing: Array<"KAPSO_API_KEY" | "KAPSO_WEBHOOK_SECRET">;
  provider: WhatsAppProviderId;
  webhookSecret: SecretStatus;
};

export type WhatsAppRuntimeInput = {
  kapsoApiKey?: string;
  provider: WhatsAppProviderId;
  webhookSecret?: string;
};

/** Devuelve solo estado seguro; nunca incluye el contenido de un secreto. */
export function diagnoseWhatsAppRuntime(
  input: WhatsAppRuntimeInput,
): WhatsAppRuntimeDiagnostic {
  if (input.provider === "simulated") {
    return {
      apiKey: "not-required",
      configured: true,
      missing: [],
      provider: "simulated",
      webhookSecret: "not-required",
    };
  }

  const apiKeyConfigured = isConfiguredSecret(input.kapsoApiKey);
  const webhookSecretConfigured = isConfiguredSecret(input.webhookSecret);

  return {
    apiKey: apiKeyConfigured ? "configured" : "not-configured",
    configured: apiKeyConfigured && webhookSecretConfigured,
    missing: [
      ...(apiKeyConfigured ? [] : ["KAPSO_API_KEY" as const]),
      ...(webhookSecretConfigured ? [] : ["KAPSO_WEBHOOK_SECRET" as const]),
    ],
    provider: "kapso",
    webhookSecret: webhookSecretConfigured ? "configured" : "not-configured",
  };
}

/** Falla cerrado sin interpolar ningún valor sensible en el mensaje. */
export function assertWhatsAppRuntimeReady(input: WhatsAppRuntimeInput): void {
  const diagnostic = diagnoseWhatsAppRuntime(input);
  if (diagnostic.configured) return;

  throw new Error(
    `WHATSAPP_DELIVERY=${input.provider} requiere ${diagnostic.missing.join(" y ")}`,
  );
}

function isConfiguredSecret(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}
