import { z } from "zod";

import { processSimulatedWhatsAppMessage } from "~/server/application/simulated-whatsapp-booking";
import { publicProcedure } from "~/server/api/trpc";
import { drizzleSimulatedWhatsAppBookingStore } from "~/server/db/simulated-whatsapp-booking-store";

/** Punto de entrada del adaptador simulado; no expone el almacén a Asclepio. */
export const asclepioRouter = {
  receiveSimulatedWhatsAppMessage: publicProcedure
    .input(
      z.object({
        from: z.string().max(32),
        id: z.string().min(1).max(160),
        text: z.string().max(1_000),
        to: z.string().max(32),
      }),
    )
    .mutation(({ input }) =>
      processSimulatedWhatsAppMessage(
        input,
        drizzleSimulatedWhatsAppBookingStore,
      ),
    ),
};
