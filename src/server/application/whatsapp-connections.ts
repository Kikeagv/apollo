import type { WhatsAppConnection } from "~/domain/whatsapp-connection";
import { drizzleWhatsAppConnectionReader } from "~/server/db/whatsapp-connection-store";

export type WhatsAppConnectionReader = {
  read(input: {
    clinicId: string;
    identityId: string;
  }): Promise<WhatsAppConnection | undefined>;
};

/** Consulta la única Conexión de WhatsApp visible para la Clínica actual. */
export function getWhatsAppConnection(
  input: { clinicId: string; identityId: string },
  reader: WhatsAppConnectionReader = drizzleWhatsAppConnectionReader,
) {
  return reader.read(input);
}
