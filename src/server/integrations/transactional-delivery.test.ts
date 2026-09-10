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

  it("recalcula texto o Utility con el reloj del worker y conserva el resultado de Kapso", async () => {
    const sendReminder = vi.fn().mockResolvedValue({
      providerMessageId: "wamid-1",
      status: "accepted",
    });
    const provider: WhatsAppProvider = {
      appointmentMessageSender: { send: vi.fn() },
      appointmentReminderSender: { send: sendReminder },
      provider: "kapso",
      sendConversationReply: vi.fn(),
      sendConversationEscalationNotification: vi.fn(),
    };
    const delivery: TransactionalDelivery = {
      attempts: 2,
      clinicId: "clinic-1",
      id: "delivery-1",
      idempotencyKey: "appointment-1:24h:contact-1",
      kind: "appointment-reminder",
      payload: {
        appointmentId: "appointment-1",
        appointmentStartsAt: new Date("2026-09-10T12:00:00.000Z"),
        checkpoint: "24h",
        clinicName: "Clínica Central",
        recipient: {
          id: "contact-1",
          name: "Ana",
          phoneE164: "+50370000001",
        },
        serviceWindowExpiresAt: new Date("2026-09-09T11:00:00.000Z"),
        template: {
          category: "UTILITY",
          locale: "es",
          name: "appointment_reminder",
          parameters: ["Ana", "Clínica Central"],
          providerTemplateId: "template-1",
          status: "APPROVED",
        },
        text: "Tu cita es mañana.",
      },
    };

    await expect(
      transactionalDeliveryAdapter(provider).send(delivery, {
        now: new Date("2026-09-09T12:00:00.000Z"),
      }),
    ).resolves.toEqual({ providerMessageId: "wamid-1", status: "accepted" });
    expect(sendReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        route: {
          kind: "template",
          locale: "es",
          name: "appointment_reminder",
          parameters: ["Ana", "Clínica Central"],
          providerTemplateId: "template-1",
        },
      }),
    );
  });

  it("no permite que una ruta persistida evada la plantilla fuera de ventana", async () => {
    const provider: WhatsAppProvider = {
      appointmentMessageSender: { send: vi.fn() },
      appointmentReminderSender: { send: vi.fn() },
      provider: "kapso",
      sendConversationReply: vi.fn(),
      sendConversationEscalationNotification: vi.fn(),
    };

    await expect(
      transactionalDeliveryAdapter(provider).send(
        {
          attempts: 1,
          clinicId: "clinic-1",
          id: "delivery-1",
          idempotencyKey: "delivery-1",
          kind: "appointment-reminder",
          payload: {
            appointmentId: "appointment-1",
            appointmentStartsAt: new Date("2026-09-10T12:00:00.000Z"),
            checkpoint: "24h",
            clinicName: "Clínica Central",
            recipient: {
              id: "contact-1",
              name: "Ana",
              phoneE164: "+50370000001",
            },
            route: { kind: "text", text: "Ruta no autorizada" },
            serviceWindowExpiresAt: new Date("2026-09-09T11:00:00.000Z"),
            text: "Tu cita es mañana.",
          },
        },
        { now: new Date("2026-09-09T12:00:00.000Z") },
      ),
    ).rejects.toThrow("Utility");
  });
});
