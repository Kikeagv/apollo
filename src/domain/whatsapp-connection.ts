import type { WhatsAppProviderId } from "./whatsapp-runtime";

export const whatsappConnectionStatuses = [
  "pending",
  "provisioning",
  "ready",
  "degraded",
  "blocked",
  "disconnected",
] as const;

export type WhatsAppConnectionStatus =
  (typeof whatsappConnectionStatuses)[number];

export const whatsappConnectionTypes = ["simulated", "coexistence"] as const;
export type WhatsAppConnectionType = (typeof whatsappConnectionTypes)[number];

/** Metadatos operativos permitidos; nunca contiene credenciales o tokens. */
export type WhatsAppConnectionMetadata = Record<string, string | null>;

const publicMetadataKeys = new Set([
  "billingStatus",
  "businessAccountName",
  "displayPhoneE164",
  "health",
  "mode",
  "source",
  "templatesStatus",
  "webhookStatus",
]);

export type WhatsAppConnection = {
  clinicId: string;
  connectionType: WhatsAppConnectionType;
  createdAt: Date;
  customer: string;
  lastTestAt: Date | null;
  metadata: WhatsAppConnectionMetadata;
  phoneNumberE164: string | null;
  phoneNumberId: string | null;
  provider: WhatsAppProviderId;
  status: WhatsAppConnectionStatus;
  updatedAt: Date;
};

export const whatsappConnectionStatusLabels: Record<
  WhatsAppConnectionStatus,
  string
> = {
  blocked: "Bloqueada",
  degraded: "Degradada",
  disconnected: "Desconectada",
  pending: "Pendiente",
  provisioning: "Provisionando",
  ready: "Lista",
};

export function whatsappConnectionStatusLabel(
  status: WhatsAppConnectionStatus,
) {
  return whatsappConnectionStatusLabels[status];
}

export function isWhatsAppConnectionReady(
  connection: WhatsAppConnectionStatus | Pick<WhatsAppConnection, "status">,
) {
  return (
    (typeof connection === "string" ? connection : connection.status) ===
    "ready"
  );
}

export function publicWhatsAppConnectionMetadata(
  metadata: WhatsAppConnectionMetadata,
): WhatsAppConnectionMetadata {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => publicMetadataKeys.has(key)),
  );
}

export function whatsappConnectionNextAction(input: {
  connectionType: WhatsAppConnectionType;
  lastTestAt?: Date | null;
  status: WhatsAppConnectionStatus;
}) {
  if (input.status === "pending") return "Completar el enlace de configuración";
  if (input.status === "provisioning")
    return "Esperar la provisión de WhatsApp";
  if (input.status === "ready") {
    if (input.connectionType === "simulated" && input.lastTestAt === null) {
      return "Ejecutar una prueba simulada";
    }
    return input.connectionType === "simulated"
      ? "Modo simulado listo"
      : "Conexión lista";
  }
  if (input.status === "degraded") return "Revisar la conexión de WhatsApp";
  if (input.status === "blocked") return "Reactivar la conexión manualmente";
  return "Reconectar WhatsApp";
}

const allowedTransitions: Record<
  WhatsAppConnectionStatus,
  readonly WhatsAppConnectionStatus[]
> = {
  blocked: ["blocked", "disconnected", "ready"],
  degraded: ["blocked", "degraded", "disconnected", "ready"],
  disconnected: ["disconnected", "pending"],
  pending: ["blocked", "disconnected", "pending", "provisioning"],
  provisioning: [
    "blocked",
    "degraded",
    "disconnected",
    "provisioning",
    "ready",
  ],
  ready: ["blocked", "degraded", "disconnected", "ready"],
};

export function canTransitionWhatsAppConnection(
  from: WhatsAppConnectionStatus,
  to: WhatsAppConnectionStatus,
) {
  return allowedTransitions[from].includes(to);
}

export function simulatedWhatsAppCustomer(clinicId: string) {
  return `simulated:${clinicId}`;
}

/** Número sintético estable para ejercitar el transporte sin un número real. */
export function simulatedWhatsAppPhoneE164(clinicId: string) {
  let value = 0n;
  for (const character of clinicId.replaceAll("-", "")) {
    value =
      (value * 33n + BigInt(character.codePointAt(0) ?? 0)) % 10_000_000_000n;
  }
  return `+5037${value.toString().padStart(10, "0")}`;
}

export function createSimulatedWhatsAppConnection(
  clinicId: string,
  now = new Date(),
): WhatsAppConnection {
  return {
    clinicId,
    connectionType: "simulated",
    createdAt: now,
    customer: simulatedWhatsAppCustomer(clinicId),
    lastTestAt: now,
    metadata: { mode: "simulated" },
    phoneNumberE164: simulatedWhatsAppPhoneE164(clinicId),
    phoneNumberId: null,
    provider: "simulated",
    status: "ready",
    updatedAt: now,
  };
}
