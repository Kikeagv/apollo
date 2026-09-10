import { describe, expect, it, vi } from "vitest";

import type { KapsoInboundMessage } from "~/domain/whatsapp-inbound";
import {
  runKapsoInboundWorker,
  type WhatsAppInboundAssistant,
  type WhatsAppInboundConsentGate,
  type WhatsAppInboundEvent,
  type WhatsAppInboundReplySender,
  type WhatsAppInboundStore,
} from "./whatsapp-inbound";

const NOW = new Date("2026-09-08T12:00:00.000Z");

function event(
  overrides: Partial<KapsoInboundMessage> = {},
): WhatsAppInboundEvent {
  return {
    attempts: 1,
    batchSequence: null,
    businessScopedUserId: "US.USER.1",
    conversationId: "conversation-1",
    customerId: "customer-1",
    direction: "inbound",
    eventName: "whatsapp.message.received",
    fromWaId: null,
    eventId: "queue-1",
    id: "message-1",
    idempotencyKey: "request-1",
    interactiveAction: null,
    leaseToken: "lease-1",
    messageTimestamp: new Date("2026-09-08T11:59:00.000Z"),
    origin: "cloud_api",
    parentBusinessScopedUserId: null,
    phoneE164: null,
    phoneNumberId: "phone-1",
    rawPayload: {},
    receivedAt: new Date("2026-09-08T11:59:01.000Z"),
    status: "processing",
    text: "info",
    type: "text",
    username: "@ana",
    ...overrides,
  };
}

function fakeStore(events: WhatsAppInboundEvent[]) {
  const outcomes: Array<{ eventId: string; status: string }> = [];
  const claimDueMessages = vi
    .fn<WhatsAppInboundStore["claimDueMessages"]>()
    .mockResolvedValue(events);
  const markAwaitingConsent = vi
    .fn<WhatsAppInboundStore["markAwaitingConsent"]>()
    .mockImplementation(async ({ eventId }) => {
      outcomes.push({ eventId, status: "awaiting-consent" });
    });
  const markConflict = vi
    .fn<WhatsAppInboundStore["markConflict"]>()
    .mockImplementation(async ({ eventId }) => {
      outcomes.push({ eventId, status: "conflict" });
    });
  const markIgnored = vi
    .fn<WhatsAppInboundStore["markIgnored"]>()
    .mockImplementation(async ({ eventId }) => {
      outcomes.push({ eventId, status: "ignored" });
    });
  const markProcessed = vi
    .fn<WhatsAppInboundStore["markProcessed"]>()
    .mockImplementation(async ({ eventId }) => {
      outcomes.push({ eventId, status: "processed" });
    });
  const markRejected = vi.fn<WhatsAppInboundStore["markRejected"]>();
  const getAssistantResponse = vi
    .fn<WhatsAppInboundStore["getAssistantResponse"]>()
    .mockResolvedValue(null);
  const resolveMessage = vi
    .fn<WhatsAppInboundStore["resolveMessage"]>()
    .mockResolvedValue({
      clinicId: "clinic-1",
      contactId: "contact-1",
      identityId: "identity-1",
      kind: "matched",
      recipientBusinessScopedUserId: "US.USER.1",
      recipientPhoneE164: null,
    });
  const scheduleRetry = vi.fn<WhatsAppInboundStore["scheduleRetry"]>();
  const suppressPendingReminderDeliveries = vi
    .fn<
      NonNullable<WhatsAppInboundStore["suppressPendingReminderDeliveries"]>
    >()
    .mockResolvedValue(0);
  const saveAssistantResponse =
    vi.fn<WhatsAppInboundStore["saveAssistantResponse"]>();
  const conversationLockKeys: Array<string | null> = [];
  const withConversationLock: WhatsAppInboundStore["withConversationLock"] =
    async ({ conversationId, operation }) => {
      conversationLockKeys.push(conversationId);
      return operation();
    };
  const store: WhatsAppInboundStore = {
    claimDueMessages,
    getAssistantResponse,
    markAwaitingConsent,
    markConflict,
    markIgnored,
    markProcessed,
    markRejected,
    resolveMessage,
    saveAssistantResponse,
    scheduleRetry,
    suppressPendingReminderDeliveries,
    withConversationLock,
  };
  return {
    markAwaitingConsent,
    markConflict,
    markIgnored,
    markProcessed,
    conversationLockKeys,
    outcomes,
    resolveMessage,
    saveAssistantResponse,
    scheduleRetry,
    suppressPendingReminderDeliveries,
    store,
  };
}

const acceptedConsentCheck = vi
  .fn<WhatsAppInboundConsentGate["check"]>()
  .mockResolvedValue({ kind: "accepted", reference: "consent-1" });
const acceptedConsent: WhatsAppInboundConsentGate = {
  check: acceptedConsentCheck,
};

function assistant() {
  const processText = vi
    .fn<WhatsAppInboundAssistant["processText"]>()
    .mockResolvedValue({ text: "Servicios disponibles." });
  return {
    processText,
  };
}

describe("worker de mensajes entrantes de WhatsApp", () => {
  it("resuelve un BSUID sin teléfono, conserva la evidencia y despierta al asistente dentro de la ventana", async () => {
    const {
      outcomes,
      saveAssistantResponse,
      store,
      suppressPendingReminderDeliveries,
    } = fakeStore([event()]);
    const acceptedAssistant = assistant();
    const { processText } = acceptedAssistant;
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();
    const replySender: WhatsAppInboundReplySender = {
      send,
    };

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        store,
        acceptedAssistant,
        acceptedConsent,
        replySender,
      ),
    ).resolves.toMatchObject({ processed: 1 });

    expect(processText).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      contactId: "contact-1",
      messageId: "message-1",
      text: "info",
      now: NOW,
    });
    expect(suppressPendingReminderDeliveries).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      contactId: "contact-1",
      now: NOW,
    });
    expect(send).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      idempotencyKey: "message-1",
      recipientBusinessScopedUserId: "US.USER.1",
      recipientPhoneE164: null,
      text: "Servicios disponibles.",
    });
    expect(saveAssistantResponse).toHaveBeenCalledWith({
      eventId: "queue-1",
      leaseToken: "lease-1",
      responseText: "Servicios disponibles.",
    });
    expect(outcomes).toEqual([{ eventId: "queue-1", status: "processed" }]);
  });

  it("reenvía una respuesta persistida sin volver a ejecutar Asclepio", async () => {
    const fake = fakeStore([event()]);
    fake.store.getAssistantResponse = vi
      .fn<WhatsAppInboundStore["getAssistantResponse"]>()
      .mockResolvedValue("Respuesta ya guardada.");
    const acceptedAssistant = assistant();
    const { processText } = acceptedAssistant;
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        acceptedConsent,
        { send },
      ),
    ).resolves.toMatchObject({ processed: 1 });

    expect(processText).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Respuesta ya guardada." }),
    );
    expect(fake.saveAssistantResponse).not.toHaveBeenCalled();
  });

  it("no despierta al asistente fuera de la ventana de servicio", async () => {
    const fake = fakeStore([
      event({
        messageTimestamp: new Date("2026-09-07T11:59:00.000Z"),
      }),
    ]);
    const acceptedAssistant = assistant();
    const { processText } = acceptedAssistant;
    const { resolveMessage, store } = fake;

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        store,
        acceptedAssistant,
        acceptedConsent,
        { send: vi.fn() },
      ),
    ).resolves.toMatchObject({ ignored: 1 });

    expect(processText).not.toHaveBeenCalled();
    expect(resolveMessage).not.toHaveBeenCalled();
  });

  it("reintenta cuando el adaptador de respuesta falla después de guardar la respuesta", async () => {
    const fake = fakeStore([event()]);
    const acceptedAssistant = assistant();
    const send = vi
      .fn<WhatsAppInboundReplySender["send"]>()
      .mockRejectedValue(new Error("Kapso no disponible"));

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        acceptedConsent,
        { send },
      ),
    ).resolves.toMatchObject({ retried: 1 });

    expect(fake.scheduleRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "queue-1",
        reason: "Kapso no disponible",
      }),
    );
  });

  it("envía solo el aviso aprobado cuando el consentimiento está pendiente", async () => {
    const fake = fakeStore([event({ id: "pending-1" })]);
    const acceptedAssistant = assistant();
    const { processText } = acceptedAssistant;
    const { markAwaitingConsent, store } = fake;
    const check = vi
      .fn<WhatsAppInboundConsentGate["check"]>()
      .mockResolvedValue({ kind: "pending" });
    const consentGate: WhatsAppInboundConsentGate = { check };
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();
    const replySender: WhatsAppInboundReplySender = { send };

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        store,
        acceptedAssistant,
        consentGate,
        replySender,
      ),
    ).resolves.toMatchObject({ awaitingConsent: 1 });

    expect(processText).not.toHaveBeenCalled();
    const sendCall = send.mock.calls[0]?.[0];
    if (sendCall === undefined)
      throw new Error("Falta el aviso de consentimiento");
    expect(sendCall.buttonLabel).toBe("CONTINUAR");
    expect(sendCall.text).toContain("CONTINUAR");
    const awaitingCall = markAwaitingConsent.mock.calls[0]?.[0];
    if (awaitingCall === undefined) throw new Error("Falta cerrar el evento");
    expect(awaitingCall.eventId).toBe("queue-1");
  });

  it("mantiene pendiente un botón interactivo distinto de CONTINUAR", async () => {
    const fake = fakeStore([
      event({ id: "other-button-1", text: null, type: "interactive" }),
    ]);
    const acceptedAssistant = assistant();
    const check = vi
      .fn<WhatsAppInboundConsentGate["check"]>()
      .mockResolvedValue({ kind: "pending" });
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        { check },
        { send },
      ),
    ).resolves.toMatchObject({ awaitingConsent: 1 });

    expect(check).toHaveBeenCalled();
    expect(acceptedAssistant.processText).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ buttonLabel: "CONTINUAR" }),
    );
  });

  it("consume CONTINUAR sin entregar la respuesta al asistente", async () => {
    const fake = fakeStore([event({ id: "continue-1", text: "CONTINUAR" })]);
    const acceptedAssistant = assistant();
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();
    const consentGate: WhatsAppInboundConsentGate = {
      check: vi.fn().mockResolvedValue({
        consume: true,
        kind: "accepted",
        reference: "consent-1",
      }),
    };

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        consentGate,
        { send },
      ),
    ).resolves.toMatchObject({ processed: 1 });

    expect(acceptedAssistant.processText).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(fake.markProcessed).toHaveBeenCalledWith({
      consentReference: "consent-1",
      eventId: "queue-1",
      leaseToken: "lease-1",
      processedAt: NOW,
    });
    expect(fake.conversationLockKeys).toEqual(["whatsapp-contact:contact-1"]);
  });

  it("mantiene urgencia y atención humana en una ruta segura sin llamar al asistente mientras el gate está pendiente", async () => {
    const fake = fakeStore([
      event({ id: "urgent-1", text: "Tengo una urgencia" }),
    ]);
    const acceptedAssistant = assistant();
    const safeRoute = {
      process: vi.fn().mockResolvedValue({
        text: "Si es una emergencia médica, llame al 911 ahora.",
      }),
    };
    const consentGate: WhatsAppInboundConsentGate = {
      check: vi.fn().mockResolvedValue({ kind: "pending" }),
    };
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        consentGate,
        { send },
        safeRoute,
      ),
    ).resolves.toMatchObject({ processed: 1 });

    expect(acceptedAssistant.processText).not.toHaveBeenCalled();
    expect(safeRoute.process).toHaveBeenCalledWith(
      expect.objectContaining({ route: "urgency", text: "Tengo una urgencia" }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Si es una emergencia médica, llame al 911 ahora.",
      }),
    );
    expect(fake.saveAssistantResponse).toHaveBeenCalledWith({
      eventId: "queue-1",
      leaseToken: "lease-1",
      responseText: "Si es una emergencia médica, llame al 911 ahora.",
    });
    expect(fake.markProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ consentReference: null }),
    );
  });

  it.each([
    ["outbound", { direction: "outbound" as const }],
    ["unknown origin", { origin: "unknown" as const }],
    ["multimedia", { type: "image", text: null }],
  ])("no despierta al asistente para %s", async (_label, overrides) => {
    const fake = fakeStore([event(overrides)]);
    const acceptedAssistant = assistant();
    const { processText } = acceptedAssistant;
    const { markIgnored, store } = fake;
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();
    const replySender: WhatsAppInboundReplySender = { send };

    await runKapsoInboundWorker(
      { now: NOW },
      store,
      acceptedAssistant,
      acceptedConsent,
      replySender,
    );

    expect(processText).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(markIgnored).toHaveBeenCalled();
  });

  it("conserva un conflicto de identidad sin fusionarlo ni despertar al asistente", async () => {
    const fake = fakeStore([event({ id: "conflict-1" })]);
    const acceptedAssistant = assistant();
    const { processText } = acceptedAssistant;
    const { markConflict, resolveMessage, store } = fake;
    resolveMessage.mockResolvedValue({
      kind: "conflict",
      reason: "BSUID y teléfono pertenecen a Contactos distintos",
    });
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();
    const replySender: WhatsAppInboundReplySender = { send };

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        store,
        acceptedAssistant,
        acceptedConsent,
        replySender,
      ),
    ).resolves.toMatchObject({ conflicts: 1 });

    expect(processText).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    const conflictCall = markConflict.mock.calls[0]?.[0];
    if (conflictCall === undefined)
      throw new Error("Falta registrar el conflicto");
    expect(conflictCall.eventId).toBe("queue-1");
    expect(conflictCall.reason).toBe(
      "BSUID y teléfono pertenecen a Contactos distintos",
    );
  });

  it.each([
    "customer-mismatch",
    "unknown-connection",
    "unknown-contact",
    "connection-not-ready",
  ] as const)("no despierta ante %s", async (kind) => {
    const fake = fakeStore([event({ id: `${kind}-1` })]);
    fake.resolveMessage.mockResolvedValue({
      kind,
      reason: `No procesar ${kind}`,
    });
    const acceptedAssistant = assistant();
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        acceptedConsent,
        { send },
      ),
    ).resolves.toMatchObject({ ignored: 1 });

    expect(acceptedAssistant.processText).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
