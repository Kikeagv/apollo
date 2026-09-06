import { describe, expect, it, vi } from "vitest";

import type { WhatsAppProvider } from "~/server/application/whatsapp-provider";
import type { TransactionalDelivery } from "~/server/application/transactional-deliveries";
import { appointmentSchedulerDeliveryAdapters } from "./appointment-scheduler-delivery";
import { transactionalDeliveryAdapter } from "./transactional-delivery";

describe("adaptadores de Entrega transaccional", () => {
  it("usa el WhatsAppProvider inyectado para un recordatorio", async () => {
    const sendReminder = vi.fn().mockResolvedValue(undefined);
    const provider: WhatsAppProvider = {
      appointmentMessageSender: { send: vi.fn() },
      appointmentReminderSender: { send: sendReminder },
      provider: "simulated",
      sendConversationReply: vi.fn(),
      sendConversationEscalationNotification: vi.fn(),
    };
    const delivery: TransactionalDelivery = {
      attempts: 1,
      clinicId: "clinic-1",
      id: "delivery-1",
      idempotencyKey: "appointment-1:24h:contact-1",
      kind: "appointment-reminder",
      payload: {
        appointmentId: "appointment-1",
        appointmentStartsAt: new Date("2026-09-06T12:00:00.000Z"),
        checkpoint: "24h",
        clinicName: "Clínica Central",
        recipient: {
          id: "contact-1",
          name: "Ana",
          phoneE164: "+50370000001",
        },
      },
    };

    await transactionalDeliveryAdapter(provider).send(delivery);

    expect(sendReminder).toHaveBeenCalledWith({
      appointmentId: "appointment-1",
      clinicId: "clinic-1",
      idempotencyKey: delivery.idempotencyKey,
      recipient: delivery.payload.recipient,
    });
    expect(appointmentSchedulerDeliveryAdapters(provider).reminderSender).toBe(
      provider.appointmentReminderSender,
    );
  });
});
