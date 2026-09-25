import { describe, expect, it, vi } from "vitest";

import type { WhatsAppProvider } from "~/server/application/whatsapp-provider";
import type { TransactionalDelivery } from "~/server/application/transactional-deliveries";
import { appointmentSchedulerDeliveryAdapters } from "./appointment-scheduler-delivery";
import { transactionalDeliveryAdapter } from "./transactional-delivery";

describe("adaptadores de Entrega transaccional", () => {
  it.each(["confirmation", "cancellation", "reschedule"] as const)(
    "envía el mensaje de Cita %s conservando su clave de idempotencia",
    async (type) => {
      const sendMessage = vi.fn().mockResolvedValue({
        providerMessageId: "wamid-appointment-1",
        status: "accepted" as const,
      });
      const provider: WhatsAppProvider = {
        appointmentMessageSender: { send: sendMessage },
        appointmentReminderSender: { send: vi.fn() },
        provider: "kapso",
        sendConversationReply: vi.fn(),
        sendConversationEscalationNotification: vi.fn(),
      };
      const delivery: TransactionalDelivery = {
        attempts: 1,
        clinicId: "clinic-1",
        id: "delivery-appointment-1",
        idempotencyKey: `appointment-1:${type}:event-1:contact-1`,
        kind: "appointment-message",
        payload: {
          appointmentId: "appointment-1",
          recipient: {
            id: "contact-1",
            name: "Ana",
            phoneE164: "+50370000001",
          },
          serviceWindowExpiresAt: new Date("2026-09-09T13:00:00.000Z"),
          template: {
            category: "UTILITY",
            locale: "es",
            name: `appointment_${type}`,
            parameters: ["Ana", "Clínica Central"],
            providerTemplateId: `template-${type}`,
            status: "APPROVED",
          },
          text: "Aviso administrativo de cita.",
          type,
        },
      };

      await expect(
        transactionalDeliveryAdapter(provider).send(delivery, {
          now: new Date("2026-09-09T12:00:00.000Z"),
        }),
      ).resolves.toEqual({
        providerMessageId: "wamid-appointment-1",
        status: "accepted",
      });
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: delivery.idempotencyKey,
          route: {
            kind: "template",
            locale: "es",
            name: `appointment_${type}`,
            parameters: ["Ana", "Clínica Central"],
            providerTemplateId: `template-${type}`,
          },
          type,
        }),
      );
    },
  );

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
        serviceWindowExpiresAt: new Date("2026-09-06T20:00:00.000Z"),
        template: {
          category: "UTILITY",
          locale: "es",
          name: "appointment_reminder",
          parameters: ["Ana", "Clínica Central"],
          providerTemplateId: "template-1",
          status: "APPROVED",
        },
        text: "Te recordamos tu cita mañana.",
      },
    };

    await transactionalDeliveryAdapter(provider).send(delivery, {
      now: new Date("2026-09-06T12:00:00.000Z"),
    });

    expect(sendReminder).toHaveBeenCalledWith({
      appointmentId: "appointment-1",
      clinicId: "clinic-1",
      idempotencyKey: delivery.idempotencyKey,
      recipient: delivery.payload.recipient,
      route: {
        kind: "template",
        locale: "es",
        name: "appointment_reminder",
        parameters: ["Ana", "Clínica Central"],
        providerTemplateId: "template-1",
      },
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

  it("falla cerrado si una ruta libre persistida llega fuera de ventana sin texto estable", async () => {
    const sendReminder = vi.fn();
    const provider: WhatsAppProvider = {
      appointmentMessageSender: { send: vi.fn() },
      appointmentReminderSender: { send: sendReminder },
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
          },
        },
        { now: new Date("2026-09-09T12:00:00.000Z") },
      ),
    ).rejects.toThrow("Utility");
    expect(sendReminder).not.toHaveBeenCalled();
  });

  it("falla cerrado ante una ventana desconocida aunque haya una ruta libre persistida", async () => {
    const sendReminder = vi.fn();
    const provider: WhatsAppProvider = {
      appointmentMessageSender: { send: vi.fn() },
      appointmentReminderSender: { send: sendReminder },
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
          },
        },
        { now: new Date("2026-09-09T12:00:00.000Z") },
      ),
    ).rejects.toThrow("Utility");
    expect(sendReminder).not.toHaveBeenCalled();
  });

  it("falla cerrado ante una plantilla persistida sin catálogo Utility válido", async () => {
    const sendReminder = vi.fn();
    const provider: WhatsAppProvider = {
      appointmentMessageSender: { send: vi.fn() },
      appointmentReminderSender: { send: sendReminder },
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
            route: {
              kind: "template",
              locale: "es",
              name: "appointment_reminder",
              parameters: [],
              providerTemplateId: "template-1",
            },
          },
        },
        { now: new Date("2026-09-09T12:00:00.000Z") },
      ),
    ).rejects.toThrow("Utility");
    expect(sendReminder).not.toHaveBeenCalled();
  });
});
