import { describe, expect, it, vi } from "vitest";

import { createKapsoWhatsAppSenders } from "./kapso-whatsapp";
import type { KapsoWhatsAppProviderError } from "./kapso-whatsapp";
import { WhatsAppConnectionRequiredError } from "~/server/application/whatsapp-provider";
import type { WhatsAppBillingCapacityStore } from "~/server/application/whatsapp-billing-capacity";
import type { reserveWhatsAppSendSlot } from "~/server/db/whatsapp-rate-limit-store";

const connection = {
  businessAccountId: "waba-1",
  clinicId: "clinic-1",
  connectionType: "coexistence" as const,
  customer: "customer-1",
  metadata: {},
  phoneNumberE164: "+50370000000",
  phoneNumberId: "phone-1",
  provider: "kapso" as const,
  status: "ready" as const,
};

describe("adaptador de envío Kapso", () => {
  it("envía texto con la clave estable y devuelve el ID externo", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid-1" }] }), {
        status: 200,
      }),
    );
    const reserveSendSlot = vi
      .fn<typeof reserveWhatsAppSendSlot>()
      .mockResolvedValue(0);
    const sender = createKapsoWhatsAppSenders({
      apiKey: "kapso-secret",
      fetchImpl,
      requireConnection: vi.fn().mockResolvedValue(connection),
      reserveSendSlot,
    });

    await expect(
      sender.appointmentReminderSender.send({
        appointmentId: "appointment-1",
        clinicId: "clinic-1",
        idempotencyKey: "appointment-1:24h:contact-1",
        recipient: {
          id: "contact-1",
          name: "Ana",
          phoneE164: "+50370000001",
        },
        route: { kind: "text", text: "Tu cita es mañana." },
      }),
    ).resolves.toEqual({ providerMessageId: "wamid-1", status: "accepted" });
    expect(reserveSendSlot).toHaveBeenCalledTimes(1);
    const reservation = reserveSendSlot.mock.calls[0]?.[0];
    expect(reservation).toMatchObject({
      clinicId: "clinic-1",
      phoneNumberId: "phone-1",
    });
    expect(reservation?.now).toBeInstanceOf(Date);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.kapso.ai/meta/whatsapp/v24.0/phone-1/messages",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "kapso-secret",
          "X-Idempotency-Key": "appointment-1:24h:contact-1",
        },
        method: "POST",
      }),
    );
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(readRequestBody(request)).toMatchObject({
      biz_opaque_callback_data: "appointment-1:24h:contact-1",
      text: { body: "Tu cita es mañana." },
      to: "50370000001",
      type: "text",
    });
  });

  it("reserva capacidad antes del POST y la liquida con el resultado aceptado", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid-capacity" }] }), {
        status: 200,
      }),
    );
    const reserve = vi
      .fn<WhatsAppBillingCapacityStore["reserve"]>()
      .mockResolvedValue({
        reserved: true,
        status: "reserved",
      });
    const settle = vi
      .fn<WhatsAppBillingCapacityStore["settle"]>()
      .mockResolvedValue(undefined);
    const capacity: WhatsAppBillingCapacityStore = {
      reserve,
      settle,
    };
    const sender = createKapsoWhatsAppSenders({
      apiKey: "kapso-secret",
      fetchImpl,
      requireConnection: vi.fn().mockResolvedValue(connection),
      reserveCapacity: capacity,
      reserveSendSlot: async () => 0,
    });

    await expect(
      sender.sendConversationReply({
        clinicId: "clinic-1",
        idempotencyKey: "capacity-1",
        recipientPhoneE164: "+50370000001",
        text: "Mensaje reservado",
      }),
    ).resolves.toEqual({
      providerMessageId: "wamid-capacity",
      status: "accepted",
    });
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: "clinic-1",
        reservationKey: "capacity-1",
      }),
    );
    expect(settle).toHaveBeenCalledTimes(1);
    const settlement = settle.mock.calls[0]?.[0];
    expect(settlement).toMatchObject({
      clinicId: "clinic-1",
      outcome: "accepted",
      reservationKey: "capacity-1",
    });
    expect(settlement?.now).toBeInstanceOf(Date);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("usa el bypass de readiness solo para la respuesta del smoke real", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid-smoke" }] }), {
        status: 200,
      }),
    );
    const requireConnection = vi.fn().mockResolvedValue(connection);
    const requireSmokeReplyConnection = vi.fn().mockResolvedValue(connection);
    const sender = createKapsoWhatsAppSenders({
      apiKey: "kapso-secret",
      fetchImpl,
      requireConnection,
      requireSmokeReplyConnection,
      reserveSendSlot: async () => 0,
    });
    const runId = "3a1917e2-bd36-4b45-9b61-e3810fd28051";

    await sender.sendConversationReply({
      clinicId: "clinic-1",
      idempotencyKey: `whatsapp-smoke:${runId}:reply`,
      recipientPhoneE164: "+50370000001",
      text: "Respuesta de prueba",
    });

    expect(requireSmokeReplyConnection).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      idempotencyKey: `whatsapp-smoke:${runId}:reply`,
      provider: "kapso",
      recipientPhoneE164: "+50370000001",
    });
    expect(requireConnection).not.toHaveBeenCalled();

    await sender.sendConversationReply({
      clinicId: "clinic-1",
      idempotencyKey: "ordinary-reply-1",
      recipientPhoneE164: "+50370000001",
      text: "Respuesta normal",
    });

    expect(requireConnection).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      provider: "kapso",
    });
    expect(requireSmokeReplyConnection).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("envía la plantilla del smoke con correlación por intento y bypass técnico", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ messages: [{ id: "wamid-template-smoke" }] }),
        {
          status: 200,
        },
      ),
    );
    const requireSmokeConnection = vi.fn().mockResolvedValue(connection);
    const requireConnection = vi.fn().mockResolvedValue(connection);
    const sender = createKapsoWhatsAppSenders({
      apiKey: "kapso-secret",
      fetchImpl,
      requireConnection,
      requireSmokeConnection,
      reserveSendSlot: async () => 0,
    });
    const idempotencyKey =
      "whatsapp-smoke:3a1917e2-bd36-4b45-9b61-e3810fd28051:template:f5d2cc37-646e-4298-a751-b348c4dc0333";

    await expect(
      sender.sendSmokeTemplate({
        clinicId: "clinic-1",
        contactId: "controlled-contact-1",
        consentEvidence: {
          acceptedAt: new Date("2026-09-30T11:00:00.000Z"),
          privacyVersion: "1.0",
          reference: "consent-1",
          termsVersion: "1.0",
          textReference: "wa-consent-v1",
        },
        idempotencyKey,
        recipientPhoneE164: "+50370000001",
        route: {
          kind: "template",
          locale: "es",
          name: "appointment_confirmation",
          parameters: ["Clínica Apolo", "Contacto de prueba", "mañana"],
          providerTemplateId: "template-1",
        },
      }),
    ).resolves.toEqual({
      providerMessageId: "wamid-template-smoke",
      status: "accepted",
    });

    expect(requireSmokeConnection).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      provider: "kapso",
    });
    expect(requireConnection).not.toHaveBeenCalled();
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(readRequestBody(request)).toMatchObject({
      biz_opaque_callback_data: idempotencyKey,
      template: {
        language: { code: "es" },
        name: "appointment_confirmation",
      },
      to: "50370000001",
      type: "template",
    });
  });

  it("conserva el circuito cerrado cuando la reserva rechaza el envío", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const reserve = vi
      .fn<WhatsAppBillingCapacityStore["reserve"]>()
      .mockResolvedValue({
        reason: "quota-exhausted",
        reserved: false,
      });
    const settle = vi
      .fn<WhatsAppBillingCapacityStore["settle"]>()
      .mockResolvedValue(undefined);
    const capacity: WhatsAppBillingCapacityStore = {
      reserve,
      settle,
    };
    const sender = createKapsoWhatsAppSenders({
      apiKey: "kapso-secret",
      fetchImpl,
      requireConnection: vi.fn().mockResolvedValue(connection),
      reserveCapacity: capacity,
      reserveSendSlot: async () => 0,
    });

    await expect(
      sender.sendConversationReply({
        clinicId: "clinic-1",
        idempotencyKey: "capacity-2",
        recipientPhoneE164: "+50370000001",
        text: "No debe salir",
      }),
    ).rejects.toThrow("cuota");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it("libera la reserva si falla el rate limiter antes del POST", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const reserve = vi
      .fn<WhatsAppBillingCapacityStore["reserve"]>()
      .mockResolvedValue({ reserved: true, status: "reserved" });
    const settle = vi
      .fn<WhatsAppBillingCapacityStore["settle"]>()
      .mockResolvedValue(undefined);
    const sender = createKapsoWhatsAppSenders({
      apiKey: "kapso-secret",
      fetchImpl,
      requireConnection: vi.fn().mockResolvedValue(connection),
      reserveCapacity: { reserve, settle },
      reserveSendSlot: vi
        .fn<typeof reserveWhatsAppSendSlot>()
        .mockRejectedValue(new Error("rate limiter unavailable")),
    });

    await expect(
      sender.sendConversationReply({
        clinicId: "clinic-1",
        idempotencyKey: "capacity-rate-limit-error",
        recipientPhoneE164: "+50370000001",
        text: "No debe quedar reservada",
      }),
    ).rejects.toThrow("rate limiter unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledTimes(1);
    const settlement = settle.mock.calls[0]?.[0];
    expect(settlement).toMatchObject({
      clinicId: "clinic-1",
      outcome: "failed",
      reservationKey: "capacity-rate-limit-error",
    });
    expect(settlement?.now).toBeInstanceOf(Date);
  });

  it("usa BSUID y el formato de plantilla Utility fuera de ventana", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid-2" }] }), {
        status: 200,
      }),
    );
    const sender = createKapsoWhatsAppSenders({
      apiKey: "kapso-secret",
      fetchImpl,
      requireConnection: vi.fn().mockResolvedValue(connection),
      reserveSendSlot: async () => 0,
    });

    await sender.appointmentReminderSender.send({
      appointmentId: "appointment-1",
      clinicId: "clinic-1",
      idempotencyKey: "delivery-1",
      recipientBusinessScopedUserId: "US.123",
      recipient: { id: "contact-1", name: "Ana", phoneE164: "+50370000001" },
      route: {
        kind: "template",
        locale: "es",
        name: "appointment_reminder",
        parameters: ["Ana", "Clínica Central"],
        providerTemplateId: "template-1",
      },
    });

    const request = fetchImpl.mock.calls[0]?.[1];
    expect(readRequestBody(request)).toMatchObject({
      recipient: "US.123",
      template: {
        language: { code: "es" },
        name: "appointment_reminder",
      },
      type: "template",
    });
    expect(readRequestBody(request).to).toBeUndefined();
  });

  it("drena una respuesta de consentimiento como botón interactivo", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid-continue" }] }), {
        status: 200,
      }),
    );
    const sender = createKapsoWhatsAppSenders({
      apiKey: "kapso-secret",
      fetchImpl,
      requireConnection: vi.fn().mockResolvedValue(connection),
      reserveSendSlot: async () => 0,
    });

    await sender.sendConversationReply({
      buttonLabel: "CONTINUAR",
      clinicId: "clinic-1",
      idempotencyKey: "inbound-1",
      recipientBusinessScopedUserId: "US.123",
      recipientPhoneE164: "+50370000001",
      text: "Revisa la información y pulsa CONTINUAR.",
    });

    const request = fetchImpl.mock.calls[0]?.[1];
    expect(readRequestBody(request)).toMatchObject({
      interactive: {
        action: {
          buttons: [
            { reply: { id: "continue", title: "CONTINUAR" }, type: "reply" },
          ],
        },
        body: { text: "Revisa la información y pulsa CONTINUAR." },
        type: "button",
      },
      recipient: "US.123",
      type: "interactive",
    });
  });

  it("expone rate limits y Retry-After en 429 para que el worker programe el backoff", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "rate limited" }), {
        headers: {
          "Retry-After": "9",
          "X-RateLimit-Limit": "100",
          "X-RateLimit-Remaining": "0",
        },
        status: 429,
      }),
    );
    const sender = createKapsoWhatsAppSenders({
      apiKey: "kapso-secret",
      fetchImpl,
      now: () => new Date("2026-09-09T12:00:00.000Z"),
      requireConnection: vi.fn().mockResolvedValue(connection),
      reserveSendSlot: async () => 0,
    });

    await expect(
      sender.appointmentReminderSender.send({
        appointmentId: "appointment-1",
        clinicId: "clinic-1",
        idempotencyKey: "delivery-1",
        recipient: { id: "contact-1", name: "Ana", phoneE164: "+50370000001" },
        route: { kind: "text", text: "Tu cita es mañana." },
      }),
    ).rejects.toMatchObject({
      ambiguous: false,
      nextAttemptAt: new Date("2026-09-09T12:00:09.000Z"),
      rateLimit: { limit: 100, remaining: 0 },
      retryable: true,
      status: 429,
    } satisfies Partial<KapsoWhatsAppProviderError>);
  });

  it("marca timeout como ambiguo y nunca lo convierte en reenvío ciego", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("network timeout"));
    const sender = createKapsoWhatsAppSenders({
      apiKey: "kapso-secret",
      fetchImpl,
      requireConnection: vi.fn().mockResolvedValue(connection),
      reserveSendSlot: async () => 0,
    });

    await expect(
      sender.appointmentReminderSender.send({
        appointmentId: "appointment-1",
        clinicId: "clinic-1",
        idempotencyKey: "delivery-1",
        recipient: { id: "contact-1", name: "Ana", phoneE164: "+50370000001" },
        route: { kind: "text", text: "Tu cita es mañana." },
      }),
    ).rejects.toMatchObject({ ambiguous: true, retryable: false, status: 0 });
  });

  it("no llama a Kapso cuando la Conexión todavía no está lista", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const sender = createKapsoWhatsAppSenders({
      apiKey: "kapso-secret",
      fetchImpl,
      requireConnection: vi
        .fn()
        .mockRejectedValue(new WhatsAppConnectionRequiredError()),
      reserveSendSlot: async () => 0,
    });

    await expect(
      sender.appointmentReminderSender.send({
        appointmentId: "appointment-1",
        clinicId: "clinic-1",
        idempotencyKey: "delivery-1",
        recipient: { id: "contact-1", name: "Ana", phoneE164: "+50370000001" },
        route: { kind: "text", text: "Tu cita es mañana." },
      }),
    ).rejects.toBeInstanceOf(WhatsAppConnectionRequiredError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("clasifica un rechazo HTTP permanente sin programar reintento", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "Plantilla inválida" } }),
        {
          status: 400,
        },
      ),
    );
    const sender = createKapsoWhatsAppSenders({
      apiKey: "kapso-secret",
      fetchImpl,
      requireConnection: vi.fn().mockResolvedValue(connection),
      reserveSendSlot: async () => 0,
    });

    await expect(
      sender.appointmentReminderSender.send({
        appointmentId: "appointment-1",
        clinicId: "clinic-1",
        idempotencyKey: "delivery-1",
        recipient: { id: "contact-1", name: "Ana", phoneE164: "+50370000001" },
        route: { kind: "text", text: "Tu cita es mañana." },
      }),
    ).rejects.toMatchObject({
      ambiguous: false,
      message: "Plantilla inválida",
      retryable: false,
      status: 400,
    });
  });
});

function readRequestBody(request: RequestInit | undefined) {
  if (typeof request?.body !== "string") {
    throw new Error("La prueba necesita un body JSON serializado");
  }
  const body: unknown = JSON.parse(request.body);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("El body de Kapso debe ser un objeto");
  }
  return body as Record<string, unknown>;
}
