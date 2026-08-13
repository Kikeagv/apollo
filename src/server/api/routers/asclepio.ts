import { z } from "zod";

import { processSimulatedWhatsAppMessage } from "~/server/application/simulated-whatsapp-booking";
import { captureAppointmentReminderCallback } from "~/server/application/appointment-reminders";
import { publicProcedure } from "~/server/api/trpc";
import { drizzleSimulatedWhatsAppBookingStore } from "~/server/db/simulated-whatsapp-booking-store";
import { drizzleAppointmentReminderCallbackStore } from "~/server/db/appointment-scheduler-store";

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
  receiveSimulatedAppointmentReminderCallback: publicProcedure
    .input(
      z.object({
        appointmentId: z.string().uuid(),
        checkpoint: z.enum(["24h", "22h", "20h"]),
        clinicId: z.string().uuid(),
        recipientContactId: z.string().uuid(),
        status: z.enum(["delivered", "failed"]),
      }),
    )
    .mutation(({ input }) =>
      captureAppointmentReminderCallback(
        input,
        drizzleAppointmentReminderCallbackStore,
      ),
    ),
};
