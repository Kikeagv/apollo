import { z } from "zod";

import { processSimulatedWhatsAppMessage } from "~/server/application/simulated-whatsapp-booking";
import { captureTransactionalDeliveryCallback } from "~/server/application/transactional-deliveries";
import { publicProcedure } from "~/server/api/trpc";
import { drizzleSimulatedWhatsAppBookingStore } from "~/server/db/simulated-whatsapp-booking-store";
import { sendSimulatedConversationEscalationNotification } from "~/server/whatsapp/simulated-appointment-messages";
import {
  drizzleTransactionalDeliveryCallbackStore,
  suppressPendingReminderDeliveries,
} from "~/server/db/transactional-delivery-store";

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
      processSimulatedWhatsAppMessage(input, {
        ...drizzleSimulatedWhatsAppBookingStore,
        notifySecretaryOfConversationEscalation:
          sendSimulatedConversationEscalationNotification,
        suppressPendingReminderDeliveries,
      }),
    ),
  receiveSimulatedAppointmentReminderCallback: publicProcedure
    .input(
      z.object({
        idempotencyKey: z.string().min(1).max(300),
        status: z.enum(["delivered", "failed"]),
      }),
    )
    .mutation(({ input }) =>
      captureTransactionalDeliveryCallback(
        input,
        drizzleTransactionalDeliveryCallbackStore,
      ),
    ),
};
