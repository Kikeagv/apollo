import type { WhatsAppProviderId } from "~/domain/whatsapp-runtime";
import type { AppointmentReminderSender } from "./appointment-reminders";
import type { ConversationEscalationTrigger } from "./conversation-escalations";
import type { ManualAppointmentMessageSender } from "./manual-appointments";

export class WhatsAppConnectionRequiredError extends Error {
  constructor() {
    super("La Clínica no tiene una Conexión de WhatsApp lista para enviar");
    this.name = "WhatsAppConnectionRequiredError";
  }
}

export class WhatsAppCircuitBreakerOpenError extends Error {
  readonly circuitOpen = true;
  readonly clinicId: string;
  readonly retryable = true;

  constructor(clinicId: string, reason?: string) {
    super(
      reason === undefined
        ? "La Conexión de WhatsApp está pausada por el circuit breaker"
        : `La Conexión de WhatsApp está pausada: ${reason}`,
    );
    this.clinicId = clinicId;
    this.name = "WhatsAppCircuitBreakerOpenError";
  }
}

export type WhatsAppSendResult = {
  providerMessageId: string;
  status: "accepted";
};

/** Puerto único de salida de WhatsApp para los casos de uso de Praxia. */
export type WhatsAppProvider = {
  appointmentMessageSender: ManualAppointmentMessageSender;
  appointmentReminderSender: AppointmentReminderSender;
  provider: WhatsAppProviderId;
  sendConversationReply(input: {
    buttonLabel?: string;
    clinicId: string;
    idempotencyKey: string;
    recipientBusinessScopedUserId?: string | null;
    recipientPhoneE164: string | null;
    text: string;
  }): Promise<WhatsAppSendResult | void>;
  sendConversationEscalationNotification(input: {
    clinicId: string;
    escalationId: string;
    recipientPhoneE164: string;
    trigger: ConversationEscalationTrigger;
  }): Promise<WhatsAppSendResult | void>;
};
