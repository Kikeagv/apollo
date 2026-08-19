import "server-only";

import twilio from "twilio";

import type { AppointmentReminderSender } from "~/server/application/appointment-reminders";
import type { ConversationEscalationTrigger } from "~/server/application/conversation-escalations";
import type { ManualAppointmentMessageSender } from "~/server/application/manual-appointments";
import { env } from "~/env";

const CONFIRMATION_TEXT = "Su cita ha sido confirmada.";
const CANCELLATION_TEXT = "Su cita ha sido cancelada.";
const REMINDER_TEXT = "Recordatorio de su próxima cita.";
const ESCALATION_TEXT =
  "Su asistente escaló una conversación que requiere atención.";
const VOICE_UNSUPPORTED_TEXT =
  "Por ahora no puedo procesar notas de voz; envíe un mensaje de texto.";

function withWhatsAppPrefix(e164: string): string {
  return e164.startsWith("whatsapp:") ? e164 : `whatsapp:${e164}`;
}

export type TwilioWhatsAppSenders = {
  appointmentMessageSender: ManualAppointmentMessageSender;
  appointmentReminderSender: AppointmentReminderSender;
  sendConversationalReply(input: {
    body: string;
    fromE164: string;
    toE164: string;
  }): Promise<void>;
  sendConversationEscalationNotification(input: {
    clinicId: string;
    escalationId: string;
    recipientPhoneE164: string;
    trigger: ConversationEscalationTrigger;
  }): Promise<void>;
  sendUnsupportedMediumReply(input: {
    fromE164: string;
    toE164: string;
  }): Promise<void>;
};

/**
 * Adaptador productivo de WhatsApp vía Twilio. El guard de configuración
 * exige los secretos antes de seleccionar este adaptador; aquí solo se
 * construye el cliente y se envían mensajes de texto transaccionales. Las
 * plantillas y el texto final de WhatsApp los define el trabajo de APO-25
 * (Meta/Twilio); estos textos son un mínimo operativo mientras el adaptador
 * no está activado en producción.
 */
function requireTwilioSecret(value: string | undefined, name: string): string {
  if (value === undefined || value === "") {
    throw new Error(`Falta ${name} para WhatsApp por Twilio`);
  }
  return value;
}

export function createTwilioWhatsAppSenders(): TwilioWhatsAppSenders {
  const accountSid = requireTwilioSecret(
    env.TWILIO_ACCOUNT_SID,
    "TWILIO_ACCOUNT_SID",
  );
  const authToken = requireTwilioSecret(
    env.TWILIO_AUTH_TOKEN,
    "TWILIO_AUTH_TOKEN",
  );
  const fromE164 = requireTwilioSecret(
    env.TWILIO_WHATSAPP_FROM,
    "TWILIO_WHATSAPP_FROM",
  );
  const client = twilio(accountSid, authToken);

  async function send(body: string, toE164: string, fromToUse = fromE164) {
    await client.messages.create({
      body,
      from: withWhatsAppPrefix(fromToUse),
      to: withWhatsAppPrefix(toE164),
    });
  }

  return {
    appointmentMessageSender: {
      async send(message) {
        const text =
          message.type === "manual-confirmation"
            ? CONFIRMATION_TEXT
            : CANCELLATION_TEXT;
        await send(text, message.recipient.phoneE164);
      },
    },
    appointmentReminderSender: {
      async send(reminder) {
        await send(REMINDER_TEXT, reminder.recipient.phoneE164);
      },
    },
    sendConversationalReply({ body, fromE164, toE164 }) {
      return send(body, toE164, fromE164);
    },
    sendConversationEscalationNotification({ recipientPhoneE164 }) {
      return send(ESCALATION_TEXT, recipientPhoneE164);
    },
    sendUnsupportedMediumReply({ fromE164, toE164 }) {
      return send(VOICE_UNSUPPORTED_TEXT, toE164, fromE164);
    },
  };
}
