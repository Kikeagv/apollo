import type { WhatsAppRuntimeDiagnostic } from "~/domain/whatsapp-runtime";
import { diagnoseWhatsAppRuntime } from "~/domain/whatsapp-runtime";
import { env } from "~/env";
import { inSuperadminTransaction } from "~/server/db/clinic-context";

export type WhatsAppRuntimeDiagnosticReader = {
  read(input: { identityId: string }): Promise<WhatsAppRuntimeDiagnostic>;
};

/**
 * Caso de uso de lectura del diagnóstico. El lector por defecto comprueba la
 * Identidad de superadmin dentro de una transacción antes de leer el runtime;
 * los secretos no se guardan ni atraviesan la respuesta.
 */
export async function getWhatsAppRuntimeDiagnostic(
  input: { identityId: string },
  reader: WhatsAppRuntimeDiagnosticReader = drizzleWhatsAppRuntimeDiagnosticReader,
) {
  return reader.read(input);
}

export const drizzleWhatsAppRuntimeDiagnosticReader: WhatsAppRuntimeDiagnosticReader =
  {
    read(input) {
      return inSuperadminTransaction(input.identityId, async () =>
        diagnoseWhatsAppRuntime({
          kapsoApiKey: env.KAPSO_API_KEY,
          provider: env.WHATSAPP_DELIVERY,
          webhookSecret: env.KAPSO_WEBHOOK_SECRET,
        }),
      );
    },
  };
