import { and, eq } from "drizzle-orm";

import {
  isWhatsAppConnectionReady,
  publicWhatsAppConnectionMetadata,
} from "~/domain/whatsapp-connection";
import type { WhatsAppProviderId } from "~/domain/whatsapp-runtime";
import type { WhatsAppConnectionReader } from "~/server/application/whatsapp-connections";
import { WhatsAppConnectionRequiredError } from "~/server/application/whatsapp-provider";
import {
  inClinicTransaction,
  inWhatsAppProviderTransaction,
} from "~/server/db/clinic-context";
import { clinicUsers, whatsappConnections } from "~/server/db/schema";

/** Lee la conexión sin sacar al operador del alcance RLS de su Clínica. */
export const drizzleWhatsAppConnectionReader: WhatsAppConnectionReader = {
  async read(input) {
    return inClinicTransaction(input, async (transaction) => {
      const membership = await transaction.query.clinicUsers.findFirst({
        columns: { id: true },
        where: and(
          eq(clinicUsers.clinicId, input.clinicId),
          eq(clinicUsers.identityId, input.identityId),
          eq(clinicUsers.active, true),
          eq(clinicUsers.role, "owner"),
        ),
      });
      if (membership === undefined) return undefined;

      const connection = await transaction.query.whatsappConnections.findFirst({
        where: eq(whatsappConnections.clinicId, input.clinicId),
      });
      return connection === undefined
        ? undefined
        : {
            ...connection,
            metadata: publicWhatsAppConnectionMetadata(connection.metadata),
          };
    });
  },
};

/** Verifica el estado y proveedor antes de cualquier envío externo. */
export async function requireWhatsAppConnectionReady(input: {
  clinicId: string;
  provider: WhatsAppProviderId;
}) {
  const connection = await inWhatsAppProviderTransaction(
    input.clinicId,
    (transaction) =>
      transaction.query.whatsappConnections.findFirst({
        where: and(
          eq(whatsappConnections.clinicId, input.clinicId),
          eq(whatsappConnections.provider, input.provider),
        ),
      }),
  );
  if (connection === undefined || !isWhatsAppConnectionReady(connection)) {
    throw new WhatsAppConnectionRequiredError();
  }
  return connection;
}
