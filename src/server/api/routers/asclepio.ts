import { z } from "zod";

import {
  processSimulatedWhatsAppMessage,
  processSimulatedWhatsAppVoiceNote,
} from "~/server/application/simulated-whatsapp-booking";
import { captureTransactionalDeliveryCallback } from "~/server/application/transactional-deliveries";
import { publicProcedure } from "~/server/api/trpc";
import { drizzleSimulatedWhatsAppBookingStore } from "~/server/db/simulated-whatsapp-booking-store";
import { sendSimulatedConversationEscalationNotification } from "~/server/whatsapp/simulated-appointment-messages";
import { createSimulatedAudioTranscriber } from "~/server/integrations/audio-transcriber";
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
  /**
   * Entrada exclusiva del adaptador simulado. El transcript sirve para simular
   * al proveedor: nunca se guarda ni se incluye en errores del caso de uso.
   */
  receiveSimulatedWhatsAppVoiceNote: publicProcedure
    .input(
      z.object({
        audioBase64: z.string().max(35 * 1024 * 1024),
        contentType: z.string().max(80),
        from: z.string().max(32),
        id: z.string().min(1).max(160),
        simulatedFailure: z
          .enum(["conversion-failed", "provider-unavailable", "rate-limited"])
          .optional(),
        simulatedTranscript: z.string().max(1_000).optional(),
        to: z.string().max(32),
      }),
    )
    .mutation(({ input }) =>
      processSimulatedWhatsAppVoiceNote(
        {
          audio: Buffer.from(input.audioBase64, "base64"),
          contentType: input.contentType,
          from: input.from,
          id: input.id,
          to: input.to,
        },
        {
          ...drizzleSimulatedWhatsAppBookingStore,
          notifySecretaryOfConversationEscalation:
            sendSimulatedConversationEscalationNotification,
          suppressPendingReminderDeliveries,
        },
        createSimulatedAudioTranscriber({
          failure: input.simulatedFailure,
          transcript: input.simulatedTranscript,
        }),
      ),
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
