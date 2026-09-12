import { describe, expect, it, vi } from "vitest";

import type { WhatsAppInboundMessage } from "~/domain/whatsapp-inbound";
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
  overrides: Partial<WhatsAppInboundMessage> = {},
): WhatsAppInboundEvent {
  return {
    attempts: 1,
    batchFirstSequence: null,
    batchSequence: null,
    businessScopedUserId: "US.USER.1",
    conversationId: "conversation-1",
    customerReference: "customer-1",
    direction: "inbound",
    eventName: "whatsapp.message.received",
    fromWaId: null,
    eventId: "queue-1",
    id: "message-1",
    idempotencyKey: "request-1",
    interactiveAction: null,
    leaseToken: "lease-1",
    messageTimestamp: new Date("2026-09-08T11:59:00.000Z"),
    origin: "api",
    parentBusinessScopedUserId: null,
    phoneE164: null,
    connectionReference: "phone-1",
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
  const recordOperationalAlert =
    vi.fn<WhatsAppInboundStore["recordOperationalAlert"]>();
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
    recordOperationalAlert,
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
    markRejected,
    recordOperationalAlert,
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

const inactiveTakeover = {
  activate: vi.fn().mockResolvedValue(undefined),
  isActive: vi.fn().mockResolvedValue(false),
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
        undefined,
        inactiveTakeover,
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
      serviceWindowExpiresAt: new Date("2026-09-09T11:59:00.000Z"),
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
        undefined,
        inactiveTakeover,
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
        undefined,
        inactiveTakeover,
      ),
    ).resolves.toMatchObject({ ignored: 1 });

    expect(processText).not.toHaveBeenCalled();
    expect(resolveMessage).toHaveBeenCalled();
  });

  it("procesa un opt-out aunque el evento entrante llegue fuera de la ventana", async () => {
    const fake = fakeStore([
      event({
        id: "late-opt-out-1",
        messageTimestamp: new Date("2026-09-07T11:59:00.000Z"),
        text: "No me escriban más",
      }),
    ]);
    const acceptedAssistant = assistant();
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();
    const suppress = vi.fn().mockResolvedValue(1);
    fake.store.suppressPendingWhatsAppDeliveries = suppress;
    const consentGate: WhatsAppInboundConsentGate = {
      check: vi.fn().mockResolvedValue({
        kind: "revoked",
        reference: "late-opt-out-consent",
      }),
    };

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        consentGate,
        { send },
        undefined,
        inactiveTakeover,
      ),
    ).resolves.toMatchObject({ optedOut: 1 });

    expect(fake.resolveMessage).toHaveBeenCalled();
    expect(acceptedAssistant.processText).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(suppress).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      contactId: "contact-1",
      now: NOW,
    });
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
        undefined,
        inactiveTakeover,
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
        undefined,
        inactiveTakeover,
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
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();
    const activate = vi.fn().mockResolvedValue(undefined);

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        acceptedConsent,
        { send },
        undefined,
        { activate, isActive: vi.fn().mockResolvedValue(false) },
      ),
    ).resolves.toMatchObject({ processed: 1 });

    expect(acceptedAssistant.processText).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "other-button-1",
        text: "Recibimos tu mensaje. Una persona de la Clínica te atenderá pronto.",
      }),
    );
    expect(activate).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      contactId: "contact-1",
      messageId: "other-button-1",
      now: NOW,
      trigger: "unsupported-message",
    });
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
        undefined,
        inactiveTakeover,
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

  it("mantiene silencio durante un takeover aunque el consentimiento esté pendiente", async () => {
    const fake = fakeStore([event()]);
    const acceptedAssistant = assistant();
    const check = vi
      .fn<WhatsAppInboundConsentGate["check"]>()
      .mockResolvedValue({ kind: "pending" });
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();
    const takeover = {
      activate: vi.fn().mockResolvedValue(undefined),
      isActive: vi.fn().mockResolvedValue(true),
    };

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        { check },
        { send },
        undefined,
        takeover,
      ),
    ).resolves.toMatchObject({ processed: 1 });

    expect(check).not.toHaveBeenCalled();
    expect(acceptedAssistant.processText).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(takeover.activate).not.toHaveBeenCalled();
    expect(fake.markProcessed).toHaveBeenCalledWith({
      consentReference: null,
      eventId: "queue-1",
      leaseToken: "lease-1",
      processedAt: NOW,
    });
  });

  it("registra un opt-out, suprime entregas proactivas y no responde por WhatsApp", async () => {
    const fake = fakeStore([
      event({ id: "opt-out-1", text: "No me escriban más" }),
    ]);
    const acceptedAssistant = assistant();
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();
    const suppress = vi.fn().mockResolvedValue(2);
    fake.store.suppressPendingWhatsAppDeliveries = suppress;
    const consentGate: WhatsAppInboundConsentGate = {
      check: vi.fn().mockResolvedValue({
        kind: "revoked",
        reference: "consent-opt-out-1",
      }),
    };

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        consentGate,
        { send },
        undefined,
        inactiveTakeover,
      ),
    ).resolves.toMatchObject({ optedOut: 1 });

    expect(acceptedAssistant.processText).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(suppress).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      contactId: "contact-1",
      now: NOW,
    });
    expect(fake.markProcessed).toHaveBeenCalledWith({
      consentReference: "consent-opt-out-1",
      eventId: "queue-1",
      leaseToken: "lease-1",
      processedAt: NOW,
    });
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
        inactiveTakeover,
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

  it("ignora un evento saliente sin resolverlo ni despertar al asistente", async () => {
    const fake = fakeStore([event({ direction: "outbound" })]);
    const acceptedAssistant = assistant();
    const { processText } = acceptedAssistant;
    const { markIgnored, resolveMessage, store } = fake;
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();
    const replySender: WhatsAppInboundReplySender = { send };

    await runKapsoInboundWorker(
      { now: NOW },
      store,
      acceptedAssistant,
      acceptedConsent,
      replySender,
      undefined,
      inactiveTakeover,
    );

    expect(processText).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(resolveMessage).not.toHaveBeenCalled();
    expect(markIgnored).toHaveBeenCalled();
  });

  it.each([
    ["unknown origin", { origin: "unknown" as const }],
    ["audio", { type: "audio", text: null }],
    ["imagen", { type: "image", text: null }],
    ["documento", { type: "document", text: null }],
    ["ubicación", { type: "location", text: null }],
    ["interactivo", { type: "interactive", text: null }],
  ])(
    "abre takeover para %s sin despertar al asistente",
    async (_label, overrides) => {
      const fake = fakeStore([event(overrides)]);
      const acceptedAssistant = assistant();
      const { processText } = acceptedAssistant;
      const { markIgnored, markProcessed, store } = fake;
      const send = vi.fn<WhatsAppInboundReplySender["send"]>();
      const replySender: WhatsAppInboundReplySender = { send };
      const activate = vi.fn().mockResolvedValue(undefined);

      await expect(
        runKapsoInboundWorker(
          { now: NOW },
          store,
          acceptedAssistant,
          acceptedConsent,
          replySender,
          undefined,
          { activate, isActive: vi.fn().mockResolvedValue(false) },
        ),
      ).resolves.toMatchObject({ processed: 1 });

      expect(processText).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledWith({
        clinicId: "clinic-1",
        idempotencyKey: "message-1",
        recipientBusinessScopedUserId: "US.USER.1",
        recipientPhoneE164: null,
        serviceWindowExpiresAt: new Date("2026-09-09T11:59:00.000Z"),
        text: "Recibimos tu mensaje. Una persona de la Clínica te atenderá pronto.",
      });
      expect(markIgnored).not.toHaveBeenCalled();
      expect(markProcessed).toHaveBeenCalledWith({
        consentReference: null,
        eventId: "queue-1",
        leaseToken: "lease-1",
        processedAt: NOW,
      });
      expect(activate).toHaveBeenCalledWith({
        clinicId: "clinic-1",
        contactId: "contact-1",
        messageId: "message-1",
        now: NOW,
        trigger: "unsupported-message",
      });
    },
  );

  it("no responde automáticamente un mensaje no textual fuera de la ventana", async () => {
    const fake = fakeStore([
      event({
        messageTimestamp: new Date("2026-09-07T11:59:00.000Z"),
        type: "audio",
        text: null,
      }),
    ]);
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();
    const activate = vi.fn().mockResolvedValue(undefined);

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        assistant(),
        acceptedConsent,
        { send },
        undefined,
        { activate, isActive: vi.fn().mockResolvedValue(false) },
      ),
    ).resolves.toMatchObject({ processed: 1 });

    expect(send).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "unsupported-message" }),
    );
  });

  it("alerta un business_app sin Contacto sin abrir un takeover cruzado", async () => {
    const fake = fakeStore([event({ origin: "business-app" })]);
    fake.resolveMessage.mockResolvedValue({
      kind: "unknown-contact",
      reason: "No existe una Identidad vinculada",
    });
    const activate = vi.fn();

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        assistant(),
        acceptedConsent,
        { send: vi.fn() },
        undefined,
        { activate, isActive: vi.fn().mockResolvedValue(false) },
      ),
    ).resolves.toMatchObject({ rejected: 1 });

    expect(activate).not.toHaveBeenCalled();
    expect(fake.recordOperationalAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "queue-1",
        nextAction:
          "Vincular la Identidad de WhatsApp con un Contacto antes de reintentar",
      }),
    );
  });

  it("conserva history_sync multimedia sin takeover ni respuesta", async () => {
    const fake = fakeStore([
      event({ origin: "history-sync", type: "image", text: null }),
    ]);
    const acceptedAssistant = assistant();
    const check = vi.fn<WhatsAppInboundConsentGate["check"]>();
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();
    const activate = vi.fn().mockResolvedValue(undefined);

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        { check },
        { send },
        undefined,
        { activate, isActive: vi.fn().mockResolvedValue(false) },
      ),
    ).resolves.toMatchObject({ processed: 1 });

    expect(check).not.toHaveBeenCalled();
    expect(acceptedAssistant.processText).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it("activa takeover desde WhatsApp Business App sin ventana ni consentimiento", async () => {
    const fake = fakeStore([
      event({
        messageTimestamp: new Date("2026-08-01T12:00:00.000Z"),
        origin: "business-app",
      }),
    ]);
    const acceptedAssistant = assistant();
    const check = vi.fn<WhatsAppInboundConsentGate["check"]>();
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();
    const activate = vi.fn().mockResolvedValue(undefined);

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        { check },
        { send },
        undefined,
        { activate, isActive: vi.fn().mockResolvedValue(false) },
      ),
    ).resolves.toMatchObject({ processed: 1 });

    expect(check).not.toHaveBeenCalled();
    expect(acceptedAssistant.processText).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      contactId: "contact-1",
      messageId: "message-1",
      now: NOW,
      trigger: "business-app",
    });
  });

  it("activa takeover para un mensaje saliente de WhatsApp Business App", async () => {
    const fake = fakeStore([
      event({
        direction: "outbound",
        origin: "business-app",
      }),
    ]);
    const acceptedAssistant = assistant();
    const check = vi.fn<WhatsAppInboundConsentGate["check"]>();
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();
    const activate = vi.fn().mockResolvedValue(undefined);

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        { check },
        { send },
        undefined,
        { activate, isActive: vi.fn().mockResolvedValue(false) },
      ),
    ).resolves.toMatchObject({ processed: 1 });

    expect(check).not.toHaveBeenCalled();
    expect(acceptedAssistant.processText).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      contactId: "contact-1",
      messageId: "message-1",
      now: NOW,
      trigger: "business-app",
    });
  });

  it("reintenta si una ruta no textual llega sin adaptador de takeover", async () => {
    const fake = fakeStore([event({ origin: "business-app" })]);
    const acceptedAssistant = assistant();

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        acceptedConsent,
        { send: vi.fn() },
        undefined,
        {
          activate: vi
            .fn()
            .mockRejectedValue(
              new Error("La ruta de takeover humano no está disponible"),
            ),
          isActive: vi.fn().mockResolvedValue(false),
        },
      ),
    ).resolves.toMatchObject({ retried: 1 });

    expect(fake.markIgnored).not.toHaveBeenCalled();
    expect(fake.scheduleRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "queue-1",
        reason: "La ruta de takeover humano no está disponible",
      }),
    );
  });

  it("conserva history_sync textual como evento procesado sin takeover ni respuesta", async () => {
    const fake = fakeStore([event({ origin: "history-sync" })]);
    const acceptedAssistant = assistant();
    const check = vi.fn<WhatsAppInboundConsentGate["check"]>();
    const send = vi.fn<WhatsAppInboundReplySender["send"]>();
    const activate = vi.fn().mockResolvedValue(undefined);

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        { check },
        { send },
        undefined,
        { activate, isActive: vi.fn().mockResolvedValue(false) },
      ),
    ).resolves.toMatchObject({ processed: 1 });

    const resolveCall = fake.resolveMessage.mock.calls[0]?.[0];
    if (resolveCall === undefined)
      throw new Error("Falta resolver el historial");
    expect(resolveCall.mode).toBe("historical");
    expect(resolveCall.message.origin).toBe("history-sync");
    expect(check).not.toHaveBeenCalled();
    expect(acceptedAssistant.processText).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(fake.markProcessed).toHaveBeenCalledWith({
      consentReference: null,
      eventId: "queue-1",
      leaseToken: "lease-1",
      processedAt: NOW,
    });
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
        undefined,
        inactiveTakeover,
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

    const expectedOutcome =
      kind === "customer-mismatch" ||
      kind === "unknown-connection" ||
      kind === "unknown-contact"
        ? { rejected: 1 }
        : { ignored: 1 };

    await expect(
      runKapsoInboundWorker(
        { now: NOW },
        fake.store,
        acceptedAssistant,
        acceptedConsent,
        { send },
        undefined,
        inactiveTakeover,
      ),
    ).resolves.toMatchObject(expectedOutcome);

    expect(acceptedAssistant.processText).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    if (expectedOutcome.rejected === 1) {
      expect(fake.recordOperationalAlert).toHaveBeenCalledWith({
        customerReference: "customer-1",
        eventId: "queue-1",
        nextAction:
          kind === "unknown-connection"
            ? "Verificar phone_number_id y registrar la Conexión correcta antes de reintentar"
            : kind === "customer-mismatch"
              ? "Verificar el customer de Kapso y la Conexión antes de reintentar"
              : "Vincular la Identidad de WhatsApp con un Contacto antes de reintentar",
        now: NOW,
        connectionReference: "phone-1",
        reason: `No procesar ${kind}`,
      });
      expect(fake.markRejected).toHaveBeenCalledWith({
        eventId: "queue-1",
        leaseToken: "lease-1",
        processedAt: NOW,
        reason: `No procesar ${kind}`,
      });
    }
  });
});
