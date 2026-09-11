export type WhatsAppInboundAlertStatus = "open" | "resolved";

export type WhatsAppInboundOperationalAlert = {
  connectionReference: string;
  createdAt: Date;
  customerReference: string | null;
  id: string;
  inboundMessageId: string;
  nextAction: string;
  reason: string;
  resolvedByIdentityId: string | null;
  resolvedAt: Date | null;
  status: WhatsAppInboundAlertStatus;
  updatedAt: Date;
};
