import type {
  WhatsAppReadinessGateCode,
  WhatsAppReadinessGateStatus,
} from "./whatsapp-readiness";

export type WhatsAppConnectionAlertStatus = "open" | "resolved";

export type WhatsAppConnectionAlert = {
  clinicId: string;
  createdAt: Date;
  gateCode: WhatsAppReadinessGateCode;
  id: string;
  nextAction: string;
  provisioningEventId: string;
  reason: string;
  resolvedAt: Date | null;
  status: WhatsAppConnectionAlertStatus;
  updatedAt: Date;
};

export type WhatsAppConnectionAlertGate = {
  action: string;
  code: WhatsAppReadinessGateCode;
  message: string;
  status: WhatsAppReadinessGateStatus;
};

export function isWhatsAppOperationalFailure(
  status: WhatsAppReadinessGateStatus,
) {
  return status === "blocked" || status === "failed";
}
