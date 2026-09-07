export const whatsappSetupLinkStatuses = [
  "active",
  "used",
  "expired",
  "revoked",
] as const;

export type WhatsAppSetupLinkStatus =
  (typeof whatsappSetupLinkStatuses)[number];

export type WhatsAppSetupLink = {
  clinicId: string;
  createdAt: Date;
  expiresAt: Date;
  id: string;
  revokedAt: Date | null;
  status: WhatsAppSetupLinkStatus;
  updatedAt: Date;
  url: string;
  usedAt: Date | null;
};

export const WHATSAPP_SETUP_LINK_TTL_DAYS = 30;

const statusLabels: Record<WhatsAppSetupLinkStatus, string> = {
  active: "Activo",
  expired: "Vencido",
  revoked: "Revocado",
  used: "Usado",
};

export function setupLinkExpiresAt(createdAt: Date) {
  const expiresAt = new Date(createdAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + WHATSAPP_SETUP_LINK_TTL_DAYS);
  return expiresAt;
}

export function hasWhatsAppSetupLinkPolicyExpiry(
  createdAt: Date,
  expiresAt: Date,
) {
  return setupLinkExpiresAt(createdAt).getTime() === expiresAt.getTime();
}

export function whatsappSetupLinkStatus(
  link: {
    expiresAt: Date;
    status: WhatsAppSetupLinkStatus;
  },
  now = new Date(),
): WhatsAppSetupLinkStatus {
  if (link.status === "active" && link.expiresAt <= now) return "expired";
  return link.status;
}

export function isWhatsAppSetupLinkUsable(
  link: {
    expiresAt: Date;
    status: WhatsAppSetupLinkStatus;
  },
  now = new Date(),
) {
  return whatsappSetupLinkStatus(link, now) === "active";
}

export function whatsappSetupLinkStatusLabel(status: WhatsAppSetupLinkStatus) {
  return statusLabels[status];
}

export function whatsappSetupLinkNextAction(
  link: {
    expiresAt: Date;
    status: WhatsAppSetupLinkStatus;
  },
  now = new Date(),
) {
  switch (whatsappSetupLinkStatus(link, now)) {
    case "active":
      return "Completar el enlace de configuración";
    case "used":
      return "Esperar la provisión de WhatsApp";
    case "expired":
    case "revoked":
      return "Regenerar el enlace de configuración";
  }
}
