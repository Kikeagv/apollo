export const NO_SHOW_POLICIES = [
  "alert",
  "cancel-after-third-reminder",
] as const;

export type NoShowPolicy = (typeof NO_SHOW_POLICIES)[number];

export const NO_SHOW_POLICY_LABELS: Record<NoShowPolicy, string> = {
  alert: "Conservar la Cita y crear una alerta",
  "cancel-after-third-reminder":
    "Cancelar tras el tercer recordatorio sin respuesta",
};

const SECRETARY_PHONE_E164_PATTERN = /^\+[1-9]\d{1,14}$/;

export function isNoShowPolicy(value: unknown): value is NoShowPolicy {
  return (
    typeof value === "string" &&
    (NO_SHOW_POLICIES as readonly string[]).includes(value)
  );
}

/** Conserva el formato E.164 que usa el adaptador de WhatsApp. */
export function normalizeSecretaryPhoneE164(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized.length === 0) return null;
  if (!SECRETARY_PHONE_E164_PATTERN.test(normalized)) {
    throw new Error("El número de secretaria debe usar formato E.164");
  }
  return normalized;
}
