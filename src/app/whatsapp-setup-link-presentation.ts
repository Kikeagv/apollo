import {
  whatsappSetupLinkNextAction,
  type WhatsAppSetupLink,
} from "~/domain/whatsapp-setup-link";

export function setupLinkActionLabel(action: string) {
  const labels: Record<string, string> = {
    "setup-link-confirmed": "Enlace confirmado",
    "setup-link-created": "Enlace creado",
    "setup-link-expired": "Enlace vencido",
    "setup-link-provider-unavailable": "Kapso no disponible",
    "setup-link-regenerated": "Enlace regenerado",
    "setup-link-revoked": "Enlace revocado",
    "setup-link-used": "Enlace usado",
  };
  return labels[action] ?? "Evento de enlace";
}

export function setupLinkProviderStatusLabel(status: string | null) {
  const labels: Record<string, string> = {
    completed: "Completado",
    failed: "Requiere atención",
    pending: "Pendiente",
    unknown: "No disponible",
  };
  return status === null ? "No reportado" : (labels[status] ?? status);
}

export function setupLinkNextActionLabel(
  link: WhatsAppSetupLink,
  providerStatus: string | null,
  providerError: string | null,
) {
  if (providerError !== null || providerStatus === "failed") {
    return "Revisar el estado en Meta y generar un nuevo enlace";
  }
  if (providerStatus === "completed") {
    return "Esperar la provisión de WhatsApp";
  }
  return whatsappSetupLinkNextAction(link);
}
