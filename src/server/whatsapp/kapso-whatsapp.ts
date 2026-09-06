import "server-only";

import {
  WhatsAppConnectionRequiredError,
  type WhatsAppProvider,
} from "~/server/application/whatsapp-provider";
import { requireWhatsAppConnectionReady } from "~/server/db/whatsapp-connection-store";

export { WhatsAppConnectionRequiredError } from "~/server/application/whatsapp-provider";

/**
 * El runtime puede seleccionar Kapso antes de que exista una Conexión de
 * WhatsApp por Clínica. Este adaptador falla cerrado para no enviar por el
 * modo simulado ni inventar un número global; la llamada real a Kapso queda
 * para el slice de provisioning/webhooks.
 */
export type KapsoWhatsAppSenders = Omit<WhatsAppProvider, "provider">;

export function createKapsoWhatsAppSenders(): KapsoWhatsAppSenders {
  const requireConnection = async (clinicId: string) => {
    await requireWhatsAppConnectionReady({ clinicId, provider: "kapso" });
    throw new WhatsAppConnectionRequiredError();
  };

  return {
    appointmentMessageSender: {
      send: (input) => requireConnection(input.clinicId),
    },
    appointmentReminderSender: {
      send: (input) => requireConnection(input.clinicId),
    },
    sendConversationReply: (input) => requireConnection(input.clinicId),
    sendConversationEscalationNotification: (input) =>
      requireConnection(input.clinicId),
  };
}
