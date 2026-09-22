import {
  buildWhatsAppConsentPolicy,
  isWhatsAppConsentAffirmation,
  isWhatsAppConsentCurrent,
  isWhatsAppConsentOptOut,
  whatsappConsentPrompt,
  WHATSAPP_ADULT_PATIENT_CONSENT_DECLARATION,
  WHATSAPP_GUARDIAN_DECLARATION,
  WHATSAPP_TUTOR_PATIENT_CONSENT_DECLARATION,
  type WhatsAppConsentEvidence,
} from "~/domain/whatsapp-consent";
import {
  chooseTransactionalWhatsAppRoute,
  reconcileWhatsAppDeliveryStatus,
  retryAtFromKapsoHeaders,
} from "~/domain/whatsapp-delivery";
import {
  evaluateWhatsAppReadiness,
  whatsappCriticalTemplateCatalog,
  type WhatsAppReadinessInput,
} from "~/domain/whatsapp-readiness";
import { parseKapsoInboundMessagePayload } from "~/server/whatsapp/kapso-inbound";
import { parseKapsoPhoneNumberLifecycleEvent } from "~/domain/whatsapp-kapso-provisioning";
import {
  createKapsoWebhookSignature,
  verifyKapsoWebhookSignature,
} from "~/server/whatsapp/kapso-webhook-security";
import { evaluateWhatsAppRealTraffic } from "~/domain/whatsapp-traffic";
import {
  createWhatsAppConsentGate,
  type WhatsAppConsentStore,
} from "~/server/application/whatsapp-consent";
import {
  runKapsoInboundWorker,
  type WhatsAppInboundAssistant,
  type WhatsAppInboundEvent,
  type WhatsAppInboundHumanTakeover,
  type WhatsAppInboundReplySender,
  type WhatsAppInboundStore,
} from "~/server/application/whatsapp-inbound";
import { receiveKapsoWebhook } from "~/server/application/whatsapp-provisioning";
import {
  createInMemorySimulatedWhatsAppBookingStore,
  processWhatsAppTextForContact,
} from "~/server/application/simulated-whatsapp-booking";
import { isWhatsAppPatientConsentCurrent } from "~/domain/whatsapp-consent";
import type {
  WhatsAppSyntheticSmokeRunner,
  WhatsAppSyntheticSmokeRunnerResult,
} from "~/server/application/whatsapp-operations";
import { nextKapsoProvisioningAttemptAt } from "~/server/application/whatsapp-provisioning";
import { createKapsoOnboardingProvider } from "./kapso-onboarding";
import { createKapsoProvisioningProvider } from "./kapso-provisioning";

const SMOKE_NOW = new Date("2026-09-13T12:00:00.000Z");

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Contrato sintético inválido";
}

/** Ejecuta en Praxia los checks de transporte y workflow que no delegamos a Kapso. */
export async function runPraxiaWhatsAppSyntheticSmoke(input: {
  clinicId: string;
  phoneNumberId: string;
  projectWebhookId: string;
  syntheticContactId: string;
}): Promise<WhatsAppSyntheticSmokeRunnerResult> {
  const steps: WhatsAppSyntheticSmokeRunnerResult["steps"] = {};
  const syntheticContact = input.syntheticContactId.startsWith("synthetic-");
  const record = (
    code: keyof typeof steps,
    passed: boolean,
    message?: string,
  ) => {
    steps[code] = {
      evidence: passed ? `praxia:${code}` : null,
      message: passed ? undefined : message,
      passed,
    };
  };

  record(
    "connection",
    input.phoneNumberId.trim() !== "" &&
      input.projectWebhookId.trim() !== "" &&
      syntheticContact,
    "La conexión sintética no tiene identificadores operativos completos",
  );

  const inbound = await runInboundSmoke(input);
  record("reception", inbound.reception);
  record("response", inbound.response);
  record("urgency", inbound.urgency);
  record("takeover", inbound.takeover);
  record("history-sync", inbound.historySync);
  steps.duplicate = {
    evidence: inbound.duplicate ? "praxia-ingress:duplicate" : null,
    message: inbound.duplicate
      ? "Duplicado rechazado por idempotencia en ingress; la deduplicación durable del worker se cubre en la prueba de persistencia"
      : "El duplicado no fue rechazado en ingress",
    passed: inbound.duplicate,
  };

  let templateKind: string | null = null;
  try {
    templateKind = chooseTransactionalWhatsAppRoute({
      now: SMOKE_NOW,
      serviceWindowExpiresAt: null,
      template: {
        category: "UTILITY",
        locale: "es",
        name: "appointment_confirmation",
        parameters: [],
        providerTemplateId: "synthetic-template",
        status: "APPROVED",
      },
      text: "Confirmación sintética",
    }).kind;
  } catch {
    templateKind = null;
  }
  record("template", templateKind === "template");
  record(
    "delivery-status",
    reconcileWhatsAppDeliveryStatus("sent", "delivered") === "delivered",
  );

  const retryAfter = retryAtFromKapsoHeaders({
    attempt: 1,
    headers: new Headers({ "Retry-After": "5" }),
    now: SMOKE_NOW,
  });
  record("rate-limit", retryAfter.valueOf() === SMOKE_NOW.valueOf() + 5_000);
  const timeoutRetry = retryAtFromKapsoHeaders({
    attempt: 1,
    headers: new Headers(),
    now: SMOKE_NOW,
  });
  record("timeout", timeoutRetry > SMOKE_NOW);

  await runConsentSmoke(input, record, inbound);
  record("patient-consent-inbound", await runPatientConsentInboundSmoke(input));

  const legalEvaluation = evaluateWhatsAppRealTraffic({
    circuitStatus: "closed",
    clinicIsSynthetic: false,
    connectionStatus: "ready",
    gates: {},
    smoke: {
      realPatientsEnabled: false,
      status: "passed",
      syntheticContact: true,
    },
    technicalReadiness: "ready",
    trafficStatus: "blocked",
  });
  record(
    "legal-block",
    legalEvaluation.blockers.some((blocker) => blocker.code === "consent"),
  );

  // Estas comprobaciones ejercitan el contrato de transporte dentro de la
  // aplicación. El adaptador Kapso solo añade la confirmación documentada de
  // su endpoint de prueba y no inventa un contrato remoto para ellas.
  Object.assign(steps, await runTransportContractSmoke(input));

  return {
    evidence: "Smoke de Praxia ejecutado con contacto sintético",
    realPatientsEnabled: false,
    steps,
    syntheticContact,
  };
}

type PraxiaInboundSmokeResult = {
  consentContinue: boolean;
  consentPending: boolean;
  consentRejection: boolean;
  duplicate: boolean;
  historySync: boolean;
  reception: boolean;
  response: boolean;
  takeover: boolean;
  urgency: boolean;
};

async function runInboundSmoke(input: {
  clinicId: string;
  phoneNumberId: string;
}): Promise<PraxiaInboundSmokeResult> {
  const events = [
    syntheticInboundEvent(input, {
      eventId: "synthetic-reception-event",
      id: "synthetic-reception-message",
      idempotencyKey: "synthetic-reception",
      text: "Hola",
    }),
    syntheticInboundEvent(input, {
      eventId: "synthetic-urgency-event",
      id: "synthetic-urgency-message",
      idempotencyKey: "synthetic-urgency",
      text: "Tengo una urgencia médica",
    }),
    syntheticInboundEvent(input, {
      eventId: "synthetic-consent-event",
      id: "synthetic-consent-message",
      idempotencyKey: "synthetic-consent",
      interactiveAction: "continue",
      text: null,
      type: "interactive",
    }),
    syntheticInboundEvent(input, {
      eventId: "synthetic-response-event",
      id: "synthetic-response-message",
      idempotencyKey: "synthetic-response",
      text: "¿Qué servicios ofrecen?",
    }),
    syntheticInboundEvent(input, {
      eventId: "synthetic-response-duplicate-event",
      id: "synthetic-response-duplicate-message",
      idempotencyKey: "synthetic-response",
      text: "¿Qué servicios ofrecen?",
    }),
    syntheticInboundEvent(input, {
      direction: "outbound",
      eventId: "synthetic-takeover-event",
      eventName: "whatsapp.message.sent",
      id: "synthetic-takeover-message",
      idempotencyKey: "synthetic-takeover",
      origin: "business-app",
      text: "Respuesta de la Clínica",
    }),
    syntheticInboundEvent(input, {
      eventId: "synthetic-rejection-event",
      id: "synthetic-rejection-message",
      idempotencyKey: "synthetic-rejection",
      text: "No me escriban más",
    }),
    syntheticInboundEvent(input, {
      eventId: "synthetic-history-event",
      id: "synthetic-history-message",
      idempotencyKey: "synthetic-history",
      origin: "history-sync",
      text: null,
    }),
  ];
  const harness = createInboundSmokeHarness(input);
  const ingressResults = await Promise.all(
    events.map((event) => harness.enqueueKapsoEvent(event)),
  );
  const ingressAccepted = ingressResults.map((result) => result.accepted);
  const workerResult = await runKapsoInboundWorker(
    { limit: events.length, now: SMOKE_NOW },
    harness.store,
    harness.assistant,
    createWhatsAppConsentGate(harness.consentStore),
    harness.replySender,
    harness.safeRoute,
    harness.takeover,
  );
  const secondWorkerResult = await runKapsoInboundWorker(
    { limit: events.length, now: SMOKE_NOW },
    harness.store,
    harness.assistant,
    createWhatsAppConsentGate(harness.consentStore),
    harness.replySender,
    harness.safeRoute,
    harness.takeover,
  );

  return {
    consentContinue:
      harness.statusByEventId.get("synthetic-consent-event") === "processed" &&
      harness.consentStatusByInteractionId.get("synthetic-consent-message") ===
        "accepted",
    consentPending:
      harness.statusByEventId.get("synthetic-reception-event") ===
      "awaiting-consent",
    consentRejection:
      harness.statusByEventId.get("synthetic-rejection-event") ===
        "processed" &&
      harness.consentStatusByInteractionId.get(
        "synthetic-rejection-message",
      ) === "revoked" &&
      harness.pendingWhatsAppDeliveries === 0,
    duplicate:
      ingressAccepted.filter(Boolean).length === events.length - 1 &&
      workerResult.claimed === events.length - 1 &&
      secondWorkerResult.claimed === 0 &&
      harness.assistantCalls === 1,
    historySync:
      harness.statusByEventId.get("synthetic-history-event") === "processed",
    reception:
      harness.statusByEventId.get("synthetic-reception-event") ===
      "awaiting-consent",
    response:
      harness.statusByEventId.get("synthetic-response-event") === "processed" &&
      harness.assistantCalls === 1 &&
      harness.sentReplies.some(
        (reply) => reply.text === "Respuesta sintética de la Clínica",
      ),
    takeover: harness.takeoverActivations === 1,
    urgency:
      harness.statusByEventId.get("synthetic-urgency-event") === "processed" &&
      harness.safeRoutes.some(
        (route) =>
          route.messageId === "synthetic-urgency-message" &&
          route.route === "urgency",
      ) &&
      harness.sentReplies.some(
        (reply) =>
          reply.idempotencyKey === "synthetic-urgency-message" &&
          reply.text.includes("911"),
      ),
  };
}

function syntheticInboundEvent(
  input: { phoneNumberId: string },
  overrides: Partial<WhatsAppInboundEvent> = {},
): WhatsAppInboundEvent {
  return {
    attempts: 0,
    batchFirstSequence: null,
    batchSequence: null,
    businessScopedUserId: null,
    connectionReference: input.phoneNumberId,
    conversationId: "synthetic-conversation",
    customerReference: null,
    direction: "inbound",
    eventName: "whatsapp.message.received",
    fromWaId: null,
    id: "synthetic-message",
    interactiveAction: null,
    messageTimestamp: SMOKE_NOW,
    origin: "api",
    parentBusinessScopedUserId: null,
    phoneE164: null,
    rawPayload: {},
    text: "Hola",
    type: "text",
    username: null,
    eventId: "synthetic-event",
    idempotencyKey: "synthetic-idempotency",
    leaseToken: null,
    receivedAt: SMOKE_NOW,
    status: "pending",
    ...overrides,
  };
}

function syntheticKapsoInboundPayload(event: WhatsAppInboundEvent) {
  const origin =
    event.origin === "business-app"
      ? "business_app"
      : event.origin === "history-sync"
        ? "history_sync"
        : event.origin === "api"
          ? "cloud_api"
          : "unknown";
  return {
    message: {
      ...(event.interactiveAction === "continue"
        ? {
            interactive: {
              button_reply: { id: "CONTINUAR" },
              type: "button_reply",
            },
          }
        : {}),
      id: event.id,
      kapso: { direction: event.direction, origin },
      ...(event.text === null ? {} : { text: { body: event.text } }),
      type: event.type,
    },
    phone_number_id: event.connectionReference,
  };
}

function createInboundSmokeHarness(input: {
  assistant?: WhatsAppInboundAssistant;
  clinicId: string;
  contactId?: string;
  identityId?: string;
  initialConsent?: WhatsAppConsentEvidence;
}) {
  const statusByEventId = new Map<string, WhatsAppInboundEvent["status"]>();
  // Este smoke identifica de forma explícita la idempotencia de ingress. La
  // deduplicación durable de la persistencia se verifica en la prueba de DB.
  const acceptedIdempotencyKeys = new Set<string>();
  const queuedEvents: WhatsAppInboundEvent[] = [];
  const responseByEventId = new Map<string, string>();
  const consentStatusByInteractionId = new Map<
    string,
    WhatsAppConsentEvidence["status"]
  >();
  const sentReplies: Array<{ idempotencyKey: string; text: string }> = [];
  const safeRoutes: Array<{ messageId: string; route: string }> = [];
  let latestConsent: WhatsAppConsentEvidence | null =
    input.initialConsent ?? null;
  let consentWrites = 0;
  let assistantCalls = 0;
  let takeoverActivations = 0;
  let takeoverActive = false;
  let pendingWhatsAppDeliveries = 1;
  const policy = buildWhatsAppConsentPolicy("1.0");
  const enqueueInbound = (event: WhatsAppInboundEvent) => {
    if (acceptedIdempotencyKeys.has(event.idempotencyKey)) {
      return { accepted: false, eventId: event.eventId };
    }
    acceptedIdempotencyKeys.add(event.idempotencyKey);
    queuedEvents.push(event);
    statusByEventId.set(event.eventId, "pending");
    return { accepted: true, eventId: event.eventId };
  };

  const store: WhatsAppInboundStore = {
    async claimDueMessages({ limit }) {
      const claimed: WhatsAppInboundEvent[] = [];
      for (const event of queuedEvents) {
        if (claimed.length >= limit) break;
        if (statusByEventId.get(event.eventId) !== "pending") continue;
        claimed.push({ ...event, leaseToken: `lease:${event.eventId}` });
      }
      return claimed;
    },
    async markAwaitingConsent(input) {
      statusByEventId.set(input.eventId, "awaiting-consent");
    },
    async getAssistantResponse(input) {
      return responseByEventId.get(input.eventId) ?? null;
    },
    async markConflict(input) {
      statusByEventId.set(input.eventId, "conflict");
    },
    async markIgnored(input) {
      statusByEventId.set(input.eventId, "ignored");
    },
    async markProcessed(input) {
      statusByEventId.set(input.eventId, "processed");
    },
    async markRejected(input) {
      statusByEventId.set(input.eventId, "rejected");
    },
    async recordOperationalAlert(input) {
      void input;
    },
    async saveAssistantResponse(input) {
      responseByEventId.set(input.eventId, input.responseText);
    },
    async resolveMessage() {
      return {
        clinicId: input.clinicId,
        contactId: input.contactId ?? "synthetic-contact",
        identityId: input.identityId ?? `synthetic-identity:${input.clinicId}`,
        kind: "matched" as const,
        recipientBusinessScopedUserId: "synthetic-business-scoped-user",
        recipientPhoneE164: null,
      };
    },
    async scheduleRetry(input) {
      statusByEventId.set(input.eventId, "pending");
    },
    async suppressPendingReminderDeliveries() {
      return 0;
    },
    async suppressPendingWhatsAppDeliveries() {
      const suppressed = pendingWhatsAppDeliveries;
      pendingWhatsAppDeliveries = 0;
      return suppressed;
    },
    async reactivatePendingWhatsAppDeliveries() {
      return 0;
    },
    async withConversationLock({ operation }) {
      return operation();
    },
  };
  const consentStore: WhatsAppConsentStore = {
    async findLatestWhatsAppConsent() {
      return latestConsent;
    },
    async readCurrentWhatsAppConsentPolicy() {
      return policy;
    },
    async recordWhatsAppConsent(record) {
      consentWrites += 1;
      latestConsent = {
        acceptedAt: record.acceptedAt,
        acceptedRole: record.acceptedRole,
        clinicId: record.clinicId,
        contactId: record.contactId,
        declaration: record.declaration,
        id: `synthetic-consent:${consentWrites}`,
        identityId: record.identityId,
        interactionId: record.interactionId,
        patientId: record.patientId,
        phoneE164: record.phoneE164,
        privacyVersion: record.policy.privacyVersion,
        provider: "kapso",
        scope: record.scope,
        status: record.status ?? "accepted",
        termsVersion: record.policy.termsVersion,
        textReference: record.policy.immutableTextReference,
      };
      consentStatusByInteractionId.set(
        record.interactionId,
        latestConsent.status,
      );
      return latestConsent;
    },
  };
  const defaultAssistant: WhatsAppInboundAssistant = {
    async processText() {
      assistantCalls += 1;
      return { text: "Respuesta sintética de la Clínica" };
    },
  };
  const assistant = input.assistant ?? defaultAssistant;
  const replySender: WhatsAppInboundReplySender = {
    async send(reply) {
      if (
        !sentReplies.some(
          (candidate) => candidate.idempotencyKey === reply.idempotencyKey,
        )
      ) {
        sentReplies.push({
          idempotencyKey: reply.idempotencyKey,
          text: reply.text,
        });
      }
    },
  };
  const takeover: WhatsAppInboundHumanTakeover = {
    async activate() {
      takeoverActive = true;
      takeoverActivations += 1;
    },
    async isActive() {
      return takeoverActive;
    },
  };

  return {
    assistant,
    consentStore,
    consentStatusByInteractionId,
    get assistantCalls() {
      return assistantCalls;
    },
    get latestConsent() {
      return latestConsent;
    },
    replySender,
    safeRoutes,
    safeRoute: {
      async process(routeInput: { messageId: string; route: string }) {
        safeRoutes.push(routeInput);
        return {
          text:
            routeInput.route === "urgency"
              ? "Si es una emergencia médica, llame al 911 ahora."
              : "Respuesta segura sintética",
        };
      },
    },
    sentReplies,
    statusByEventId,
    store,
    takeover,
    get pendingWhatsAppDeliveries() {
      return pendingWhatsAppDeliveries;
    },
    async enqueueKapsoEvent(event: WhatsAppInboundEvent) {
      return receiveKapsoWebhook({
        eventName: event.eventName,
        idempotencyKey: event.idempotencyKey,
        payload: syntheticKapsoInboundPayload(event),
        store: {
          enqueue: async () => ({ accepted: false, eventId: "unsupported" }),
          enqueueDeliveryStatus: async () => ({
            accepted: false,
            eventId: "unsupported",
          }),
          enqueueIgnored: async () => ({
            accepted: false,
            eventId: "unsupported",
          }),
          enqueueInbound: async ({ idempotencyKey, message }) =>
            enqueueInbound({
              ...event,
              ...message,
              eventId: event.eventId,
              idempotencyKey,
              leaseToken: null,
              status: "pending",
            }),
        },
      });
    },
    get takeoverActivations() {
      return takeoverActivations;
    },
  };
}

/** Runner local sin contactos, Pacientes ni datos clínicos reales. */
export function createSimulatedWhatsAppSyntheticSmokeRunner(): WhatsAppSyntheticSmokeRunner {
  return {
    async run(input) {
      const praxia = await runPraxiaWhatsAppSyntheticSmoke(input);
      return {
        evidence: "Smoke sintético local ejecutado",
        providerTransportVerified: false,
        realPatientsEnabled: praxia.realPatientsEnabled,
        steps: praxia.steps,
        syntheticContact: praxia.syntheticContact,
      };
    },
  };
}

async function runTransportContractSmoke(input: {
  phoneNumberId: string;
  projectWebhookId: string;
  syntheticContactId: string;
}): Promise<WhatsAppSyntheticSmokeRunnerResult["steps"]> {
  const synthetic = input.syntheticContactId.startsWith("synthetic-");
  const steps: WhatsAppSyntheticSmokeRunnerResult["steps"] = {};
  const record = (
    code: keyof typeof steps,
    passed: boolean,
    message?: string,
  ) => {
    steps[code] = {
      evidence: passed ? `praxia-transport:${code}` : null,
      message: passed ? undefined : message,
      passed,
    };
  };

  try {
    const lifecycle = parseKapsoPhoneNumberLifecycleEvent(
      "whatsapp.phone_number.created",
      {
        business_account_id: "synthetic-business-account",
        customer: { id: "synthetic-customer" },
        display_phone_number: "+503 7000 0092",
        phone_number_id: input.phoneNumberId,
        project: { id: "synthetic-project" },
      },
    );
    record(
      "phone-number-created",
      lifecycle.phoneNumberId === input.phoneNumberId &&
        lifecycle.projectId === "synthetic-project" &&
        synthetic,
    );
  } catch (error) {
    record("phone-number-created", false, errorMessage(error));
  }

  try {
    let requestBody: Record<string, unknown> | null = null;
    const provider = createKapsoOnboardingProvider({
      apiKey: "synthetic-api-key",
      fetchImpl: async (_url, init) => {
        requestBody =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null;
        return new Response(
          JSON.stringify({
            data: {
              created_at: SMOKE_NOW.toISOString(),
              expires_at: "2026-10-13T12:00:00.000Z",
              id: "synthetic-setup-link",
              status: "active",
              url: "https://kapso.example/synthetic-setup-link",
              whatsapp_setup_error: null,
              whatsapp_setup_status: "pending",
            },
          }),
          { status: 201 },
        );
      },
    });
    const successRedirectUrl =
      "https://app.usepraxia.com/configuracion/whatsapp?status=success";
    const failureRedirectUrl =
      "https://app.usepraxia.com/configuracion/whatsapp?status=error";
    const setupLink = await provider.createSetupLink({
      allowedOrigin: "https://app.usepraxia.com",
      customerId: "synthetic-customer",
      failureRedirectUrl,
      successRedirectUrl,
    });
    const capturedRequestBody = requestBody as Record<string, unknown> | null;
    const setupLinkPayload = capturedRequestBody?.setup_link;
    const redirectPayload =
      typeof setupLinkPayload === "object" && setupLinkPayload !== null
        ? (setupLinkPayload as Record<string, unknown>)
        : null;
    record(
      "redirect",
      setupLink.url === "https://kapso.example/synthetic-setup-link" &&
        redirectPayload?.failure_redirect_url === failureRedirectUrl &&
        redirectPayload?.success_redirect_url === successRedirectUrl,
    );
  } catch (error) {
    record("redirect", false, errorMessage(error));
  }

  try {
    const batch = parseKapsoInboundMessagePayload(
      {
        batch_info: { first_sequence: 500 },
        data: [
          {
            message: {
              from_wa_id: "synthetic-wa-1",
              id: "synthetic-batch-1",
              kapso: { direction: "inbound" },
              text: { body: "uno" },
              type: "text",
            },
            phone_number_id: input.phoneNumberId,
          },
          {
            message: {
              from_wa_id: "synthetic-wa-1",
              id: "synthetic-batch-2",
              kapso: { direction: "inbound" },
              text: { body: "dos" },
              type: "text",
            },
            phone_number_id: input.phoneNumberId,
          },
        ],
        phone_number_id: input.phoneNumberId,
      },
      "whatsapp.message.received",
    );
    record(
      "batched-webhook",
      batch.length === 2 &&
        batch[0]?.batchSequence === 500 &&
        batch[1]?.batchSequence === 501 &&
        batch.every(
          (message) => message.connectionReference === input.phoneNumberId,
        ),
    );
  } catch (error) {
    record("batched-webhook", false, errorMessage(error));
  }

  try {
    const rawBody = JSON.stringify({
      event: "synthetic",
      phone_number_id: input.phoneNumberId,
    });
    const validSignature = createKapsoWebhookSignature(
      rawBody,
      "synthetic-secret",
    );
    const invalidSignatureAccepted = verifyKapsoWebhookSignature({
      rawBody,
      secret: "synthetic-secret",
      signature: "sha256=" + "0".repeat(64),
    });
    record(
      "invalid-signature",
      verifyKapsoWebhookSignature({
        rawBody,
        secret: "synthetic-secret",
        signature: validSignature,
      }) && !invalidSignatureAccepted,
    );
  } catch (error) {
    record("invalid-signature", false, errorMessage(error));
  }

  try {
    const retryAt = nextKapsoProvisioningAttemptAt(SMOKE_NOW, 1);
    record("webhook-retry", retryAt.valueOf() === SMOKE_NOW.valueOf() + 10_000);
  } catch (error) {
    record("webhook-retry", false, errorMessage(error));
  }

  try {
    let calls = 0;
    const provider = createKapsoProvisioningProvider({
      apiKey: "synthetic-api-key",
      fetchImpl: async (_url, init) => {
        calls += 1;
        if (init?.method === "GET") {
          return new Response(
            JSON.stringify({
              data: [
                {
                  active: false,
                  events: ["whatsapp.message.received"],
                  id: "synthetic-paused-webhook",
                  kind: "kapso",
                  phone_number_id: input.phoneNumberId,
                  url: "https://app.usepraxia.com/api/webhooks/kapso",
                },
              ],
              meta: { page: 1, total_pages: 1 },
            }),
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              active: true,
              events: ["whatsapp.message.received"],
              id: "synthetic-paused-webhook",
              kind: "kapso",
              phone_number_id: input.phoneNumberId,
              url: "https://app.usepraxia.com/api/webhooks/kapso",
            },
          }),
          { status: 200 },
        );
      },
      secretKey: "synthetic-secret",
      webhookUrl: "https://app.usepraxia.com/api/webhooks/kapso",
    });
    const repaired = await provider.ensurePhoneNumberWebhook(
      input.phoneNumberId,
    );
    record(
      "webhook-paused",
      repaired.remoteId === "synthetic-paused-webhook" &&
        repaired.wasPaused === true &&
        calls === 2,
    );
  } catch (error) {
    record("webhook-paused", false, errorMessage(error));
  }
  const readinessInput = simulatedReadinessInput(input);
  const templateStatuses = ["PENDING", "REJECTED", "DISABLED"] as const;
  record(
    "template-status",
    templateStatuses.every((status) => {
      const readiness = evaluateWhatsAppReadiness({
        ...readinessInput,
        templates: readinessInput.templates.map((template, index) =>
          index === 0 ? { ...template, status } : template,
        ),
      });
      return readiness.status !== "ready";
    }),
  );
  const billing = evaluateWhatsAppReadiness({
    ...readinessInput,
    billing: {
      ...readinessInput.billing,
      alertThresholdCents: null,
      mode: "unknown",
      status: "pending",
    },
  });
  record(
    "billing",
    billing.status !== "ready" &&
      billing.gates.some(
        (gate) => gate.code === "billing" && gate.status !== "ready",
      ),
  );
  const sandbox = evaluateWhatsAppReadiness({
    ...readinessInput,
    number: { ...readinessInput.number, environment: "sandbox" },
  });
  record(
    "sandbox",
    sandbox.status === "blocked" &&
      sandbox.gates.some(
        (gate) => gate.code === "number" && gate.status === "blocked",
      ),
  );
  return steps;
}

function simulatedReadinessInput(input: {
  phoneNumberId: string;
}): WhatsAppReadinessInput {
  return {
    billing: {
      alertThresholdCents: 100,
      chargesSeparated: true,
      consumedCents: 10,
      creditCents: 1_000,
      creditLimitCents: 10_000,
      creditReserveCents: 100,
      estimatedDailyConsumptionCents: 100,
      mode: "partner_managed",
      status: "ready",
    },
    connection: {
      businessAccountId: "synthetic-business-account",
      connectionType: "coexistence",
      phoneNumberId: input.phoneNumberId,
      provider: "kapso",
      status: "ready",
    },
    e2e: {
      evidence: "synthetic:message-roundtrip",
      evidenceScope: "message-roundtrip",
      lastTestAt: SMOKE_NOW,
      status: "passed",
    },
    number: {
      environment: "production",
      health: "healthy",
      healthCheckedAt: SMOKE_NOW,
    },
    templatesSync: { status: "ready" },
    templates: whatsappCriticalTemplateCatalog.map((template) => ({
      category: template.category,
      kind: template.kind,
      locale: template.locale,
      name: template.name,
      providerTemplateId: `synthetic-template:${template.kind}`,
      rejectionReason: null,
      status: "APPROVED" as const,
      syncedAt: SMOKE_NOW,
      variables: [...template.variables],
    })),
    webhooks: {
      phoneNumber: { status: "ready" },
      project: { status: "ready" },
    },
  };
}

async function runConsentSmoke(
  input: ConsentSmokeInput,
  record: ConsentSmokeRecorder,
  inbound: PraxiaInboundSmokeResult,
) {
  const policy = buildWhatsAppConsentPolicy("1.0");
  const harness = createConsentHarness(policy);
  const base = {
    clinicId: input.clinicId,
    contactId: input.syntheticContactId,
    identityId: `synthetic-identity:${input.clinicId}`,
    messageId: "synthetic-consent-message",
    now: SMOKE_NOW,
    phoneE164: null,
  } as const;

  const pending = await harness.gate.check({
    ...base,
    interactiveAction: null,
    text: "hola",
  });
  record(
    "consent-pending",
    inbound.consentPending &&
      pending.kind === "pending" &&
      pending.prompt?.text === whatsappConsentPrompt(policy),
  );

  const buttonAccepted = await harness.gate.check({
    ...base,
    interactiveAction: "continue",
    messageId: "synthetic-consent-button",
    text: null,
  });
  record(
    "consent-continue",
    inbound.consentContinue &&
      buttonAccepted.kind === "accepted" &&
      isWhatsAppConsentAffirmation({
        interactiveAction: "continue",
        text: null,
      }),
  );

  const fallbackHarness = createConsentHarness(policy);
  const fallback = await fallbackHarness.gate.check({
    ...base,
    interactiveAction: null,
    messageId: "synthetic-consent-text",
    text: "CONTINUAR",
  });
  record(
    "consent-fallback",
    fallback.kind === "accepted" &&
      isWhatsAppConsentAffirmation({
        interactiveAction: null,
        text: "CONTINUAR",
      }),
  );

  const repeated = await harness.gate.check({
    ...base,
    interactiveAction: "continue",
    messageId: "synthetic-consent-button",
    text: null,
  });
  record(
    "consent-idempotent",
    repeated.kind === "accepted" && harness.recordCount === 1,
  );

  const rejectionHarness = createConsentHarness(policy);
  const rejection = await rejectionHarness.gate.check({
    ...base,
    interactiveAction: null,
    messageId: "synthetic-consent-rejection",
    text: "No me escriban más",
  });
  record(
    "consent-rejection",
    inbound.consentRejection &&
      rejection.kind === "revoked" &&
      isWhatsAppConsentOptOut("No me escriban más"),
  );

  const versionHarness = createConsentHarness(policy);
  await versionHarness.gate.check({
    ...base,
    interactiveAction: "continue",
    messageId: "synthetic-old-consent",
    text: null,
  });
  const newPolicy = buildWhatsAppConsentPolicy("2.0");
  versionHarness.policy = newPolicy;
  const newVersion = await versionHarness.gate.check({
    ...base,
    interactiveAction: null,
    messageId: "synthetic-new-version",
    text: "info",
  });
  record(
    "consent-version",
    newVersion.kind === "pending" &&
      versionHarness.latest !== null &&
      !isWhatsAppConsentCurrent(versionHarness.latest, newPolicy),
  );

  await runAdultPatientConsentSmoke(input, policy, record);
  await runVerifiedTutorConsentSmoke(input, policy, record);
  await runPendingTutorConsentSmoke(input, policy, record);
  await runPatientSelectionSmoke(input, policy, record);
}

async function runPatientConsentInboundSmoke(
  input: ConsentSmokeInput & { phoneNumberId: string },
) {
  const policy = buildWhatsAppConsentPolicy("1.0");
  const fixture = await createPatientConsentSmokeFixture(input, policy, {
    channelConsentInteractionId: "synthetic-inbound-channel-consent",
    contactName: "Contacto Sintético",
    links: [],
    patients: [],
  });
  if (fixture.channelConsent === null) return false;

  const harness = createInboundSmokeHarness({
    assistant: {
      async processText(assistantInput) {
        const response = await processWhatsAppTextForContact(
          assistantInput,
          fixture.store,
          assistantInput.now,
        );
        return { text: response.text };
      },
    },
    clinicId: input.clinicId,
    contactId: input.syntheticContactId,
    identityId: fixture.context.identityId,
    initialConsent: fixture.channelConsent,
  });
  const commands = [
    {
      eventId: "synthetic-inbound-adult-registration-event",
      id: "synthetic-inbound-adult-registration",
      text: "registrar adulto|Paciente Sintético|01234567-8|1990-01-01",
    },
    {
      eventId: "synthetic-inbound-patient-selection-event",
      id: "synthetic-inbound-patient-selection",
      text: "paciente 1",
    },
    {
      eventId: "synthetic-inbound-patient-consent-event",
      id: "synthetic-inbound-patient-consent",
      text: `consentir paciente|${WHATSAPP_ADULT_PATIENT_CONSENT_DECLARATION}`,
    },
  ];
  const processed: boolean[] = [];
  for (const command of commands) {
    const ingress = await harness.enqueueKapsoEvent(
      syntheticInboundEvent(input, {
        ...command,
        idempotencyKey: command.eventId,
      }),
    );
    if (!ingress.accepted) {
      processed.push(false);
      continue;
    }
    const result = await runKapsoInboundWorker(
      { limit: 1, now: SMOKE_NOW },
      harness.store,
      harness.assistant,
      createWhatsAppConsentGate(harness.consentStore),
      harness.replySender,
      harness.safeRoute,
      harness.takeover,
    );
    processed.push(
      result.processed === 1 &&
        harness.statusByEventId.get(command.eventId) === "processed",
    );
  }

  const patient = fixture.store.patients[0];
  const patientConsent = fixture.store.patientConsents.find(
    (evidence) => evidence.scope === "patient",
  );
  return (
    processed.every(Boolean) &&
    patient !== undefined &&
    patientConsent?.interactionId === "synthetic-inbound-patient-consent" &&
    patientConsent.identityId === fixture.context.identityId &&
    patientConsent.acceptedRole === "adult-patient" &&
    isWhatsAppPatientConsentCurrent(patientConsent, policy, {
      acceptedRole: "adult-patient",
      patientId: patient.id,
    })
  );
}

type ConsentSmokeInput = {
  clinicId: string;
  syntheticContactId: string;
};

type ConsentSmokeRecorder = (
  code: keyof WhatsAppSyntheticSmokeRunnerResult["steps"],
  passed: boolean,
  message?: string,
) => void;

type ConsentSmokeBookingSeed = Parameters<
  typeof createInMemorySimulatedWhatsAppBookingStore
>[0];

type PatientConsentSmokeFixtureSeed = Pick<
  ConsentSmokeBookingSeed,
  "links" | "patients"
> & {
  channelConsentInteractionId?: string;
  contactName: string;
};

async function runAdultPatientConsentSmoke(
  input: ConsentSmokeInput,
  policy: ReturnType<typeof buildWhatsAppConsentPolicy>,
  record: ConsentSmokeRecorder,
) {
  const adultFixture = await createPatientConsentSmokeFixture(input, policy, {
    channelConsentInteractionId: "synthetic-adult-channel-consent",
    contactName: "Contacto Sintético",
    links: [],
    patients: [],
  });
  const adultStore = adultFixture.store;
  const adultContext = adultFixture.context;
  const adultIdentityId = adultContext.identityId;
  const adultChannelConsent = adultFixture.channelConsent;
  const adultRegistration = await processWhatsAppTextForContact(
    {
      ...adultContext,
      messageId: "synthetic-adult-registration",
      text: "registrar adulto|Paciente Sintético|01234567-8|1990-01-01",
    },
    adultStore,
    SMOKE_NOW,
  );
  const adultSelection = await processWhatsAppTextForContact(
    {
      ...adultContext,
      messageId: "synthetic-adult-selection",
      text: "paciente 1",
    },
    adultStore,
    SMOKE_NOW,
  );
  const adultPatientConsent = await processWhatsAppTextForContact(
    {
      ...adultContext,
      messageId: "synthetic-adult-patient-consent",
      text: `consentir paciente|${WHATSAPP_ADULT_PATIENT_CONSENT_DECLARATION}`,
    },
    adultStore,
    SMOKE_NOW,
  );
  const adultPatientEvidence = adultStore.patientConsents.find(
    (evidence) => evidence.scope === "patient",
  );
  const adultRegisteredPatient = adultStore.patients[0];
  record(
    "adult-flow",
    adultRegistration.kind === "patient-registered" &&
      adultSelection.kind === "patient-consent-pending" &&
      adultPatientConsent.kind === "patient-consent-accepted" &&
      adultRegisteredPatient !== undefined &&
      adultPatientEvidence !== undefined &&
      adultChannelConsent !== null &&
      isWhatsAppConsentCurrent(adultChannelConsent, policy) &&
      isWhatsAppPatientConsentCurrent(adultPatientEvidence, policy, {
        acceptedRole: "adult-patient",
        patientId: adultRegisteredPatient.id,
      }) &&
      adultPatientEvidence.identityId === adultIdentityId &&
      adultPatientEvidence.interactionId === "synthetic-adult-patient-consent",
  );
}

async function runVerifiedTutorConsentSmoke(
  input: ConsentSmokeInput,
  policy: ReturnType<typeof buildWhatsAppConsentPolicy>,
  record: ConsentSmokeRecorder,
) {
  const tutorFixture = await createPatientConsentSmokeFixture(input, policy, {
    channelConsentInteractionId: "synthetic-tutor-channel-consent",
    contactName: "Tutor Sintético",
    links: [
      {
        contactId: input.syntheticContactId,
        guardianDeclaration: WHATSAPP_GUARDIAN_DECLARATION,
        guardianDui: "01234567-8",
        guardianshipVerificationStatus: "verified",
        patientId: "synthetic-minor-patient",
        relationship: "tutor",
      },
    ],
    patients: [
      {
        birthDate: "2018-04-02",
        id: "synthetic-minor-patient",
        name: "Paciente Menor Sintético",
      },
    ],
  });
  const tutorStore = tutorFixture.store;
  const tutorContext = tutorFixture.context;
  const tutorIdentityId = tutorContext.identityId;
  const tutorChannelConsent = tutorFixture.channelConsent;
  const tutorSelection = await processWhatsAppTextForContact(
    {
      ...tutorContext,
      messageId: "synthetic-tutor-selection",
      text: "paciente 1",
    },
    tutorStore,
    SMOKE_NOW,
  );
  const tutorPatientConsent = await processWhatsAppTextForContact(
    {
      ...tutorContext,
      messageId: "synthetic-tutor-patient-consent",
      text: `consentir paciente|${WHATSAPP_TUTOR_PATIENT_CONSENT_DECLARATION}`,
    },
    tutorStore,
    SMOKE_NOW,
  );
  const tutorPatientEvidence = tutorStore.patientConsents.find(
    (evidence) => evidence.scope === "patient",
  );
  const tutorEligibility =
    await tutorStore.findWhatsAppPatientConsentEligibility({
      clinicId: input.clinicId,
      contactId: input.syntheticContactId,
      now: SMOKE_NOW,
      patientId: "synthetic-minor-patient",
    });
  record(
    "guardian-verified",
    tutorSelection.kind === "patient-consent-pending" &&
      tutorPatientConsent.kind === "patient-consent-accepted" &&
      tutorEligibility === "tutor" &&
      tutorChannelConsent !== null &&
      tutorChannelConsent.scope === "channel" &&
      tutorPatientEvidence?.acceptedRole === "tutor" &&
      tutorPatientEvidence.declaration ===
        WHATSAPP_TUTOR_PATIENT_CONSENT_DECLARATION &&
      tutorPatientEvidence.identityId === tutorIdentityId &&
      tutorPatientEvidence.interactionId ===
        "synthetic-tutor-patient-consent" &&
      isWhatsAppPatientConsentCurrent(tutorPatientEvidence, policy, {
        acceptedRole: "tutor",
        patientId: "synthetic-minor-patient",
      }),
  );
}

async function runPendingTutorConsentSmoke(
  input: ConsentSmokeInput,
  policy: ReturnType<typeof buildWhatsAppConsentPolicy>,
  record: ConsentSmokeRecorder,
) {
  const pendingFixture = await createPatientConsentSmokeFixture(input, policy, {
    channelConsentInteractionId: "synthetic-pending-channel-consent",
    contactName: "Tutor Sintético",
    links: [
      {
        contactId: input.syntheticContactId,
        guardianDeclaration: WHATSAPP_GUARDIAN_DECLARATION,
        guardianDui: "01234567-8",
        guardianshipVerificationStatus: "pending",
        patientId: "synthetic-pending-patient",
        relationship: "tutor",
      },
    ],
    patients: [
      {
        birthDate: "2018-04-02",
        id: "synthetic-pending-patient",
        name: "Paciente Pendiente Sintético",
      },
    ],
  });
  const pendingTutorStore = pendingFixture.store;
  const pendingContext = pendingFixture.context;
  const pendingChannelConsent = pendingFixture.channelConsent;
  const pendingSelection = await processWhatsAppTextForContact(
    {
      ...pendingContext,
      messageId: "synthetic-pending-selection",
      text: "paciente synthetic-pending-patient",
    },
    pendingTutorStore,
    SMOKE_NOW,
  );
  const pendingOperation = await processWhatsAppTextForContact(
    {
      ...pendingContext,
      messageId: "synthetic-pending-operation",
      text: "opciones synthetic-offer 2026-09-14",
    },
    pendingTutorStore,
    SMOKE_NOW,
  );
  const pendingConsentAttempt = await processWhatsAppTextForContact(
    {
      ...pendingContext,
      messageId: "synthetic-pending-patient-consent",
      text: `consentir paciente|${WHATSAPP_TUTOR_PATIENT_CONSENT_DECLARATION}`,
    },
    pendingTutorStore,
    SMOKE_NOW,
  );
  const pendingEligibility =
    await pendingTutorStore.findWhatsAppPatientConsentEligibility({
      clinicId: input.clinicId,
      contactId: input.syntheticContactId,
      now: SMOKE_NOW,
      patientId: "synthetic-pending-patient",
    });
  record(
    "guardian-pending",
    pendingChannelConsent !== null &&
      pendingChannelConsent.scope === "channel" &&
      pendingEligibility === "tutor-pending" &&
      pendingSelection.kind === "patient-selection-required" &&
      pendingSelection.patients.length === 0 &&
      pendingOperation.kind === "patient-selection-required" &&
      pendingConsentAttempt.kind === "patient-selection-required" &&
      pendingTutorStore.patientConsents.every(
        (evidence) => evidence.scope !== "patient",
      ),
  );
}

async function runPatientSelectionSmoke(
  input: ConsentSmokeInput,
  policy: ReturnType<typeof buildWhatsAppConsentPolicy>,
  record: ConsentSmokeRecorder,
) {
  const selectionFixture = await createPatientConsentSmokeFixture(
    input,
    policy,
    {
      contactName: "Contacto Sintético",
      links: [
        { contactId: input.syntheticContactId, patientId: "synthetic-adult-1" },
        { contactId: input.syntheticContactId, patientId: "synthetic-adult-2" },
      ],
      patients: [
        {
          birthDate: "1990-01-01",
          id: "synthetic-adult-1",
          name: "Paciente Adulto Uno",
        },
        {
          birthDate: "1988-05-01",
          id: "synthetic-adult-2",
          name: "Paciente Adulto Dos",
        },
      ],
    },
  );
  const selectionStore = selectionFixture.store;
  const selectionContext = selectionFixture.context;
  const ambiguousSelection = await processWhatsAppTextForContact(
    {
      ...selectionContext,
      messageId: "synthetic-ambiguous-operation",
      text: "opciones synthetic-offer 2026-09-14",
    },
    selectionStore,
    SMOKE_NOW,
  );
  const ambiguousConversation = await selectionStore.getConversation({
    clinicId: input.clinicId,
    contactId: input.syntheticContactId,
  });
  const emptySelectionFixture = await createPatientConsentSmokeFixture(
    input,
    policy,
    {
      contactName: "Contacto Sintético",
      links: [],
      patients: [],
    },
  );
  const emptySelectionStore = emptySelectionFixture.store;
  const absentSelection = await processWhatsAppTextForContact(
    {
      ...selectionContext,
      messageId: "synthetic-absent-operation",
      text: "opciones synthetic-offer 2026-09-14",
    },
    emptySelectionStore,
    SMOKE_NOW,
  );
  const emptyConversation = await emptySelectionStore.getConversation({
    clinicId: input.clinicId,
    contactId: input.syntheticContactId,
  });
  record(
    "patient-selection",
    ambiguousSelection.kind === "patient-selection-required" &&
      ambiguousSelection.patients.length === 2 &&
      ambiguousConversation.selectedPatientId === null &&
      absentSelection.kind === "patient-selection-required" &&
      absentSelection.patients.length === 0 &&
      emptyConversation.selectedPatientId === null,
  );
}

async function createPatientConsentSmokeFixture(
  input: ConsentSmokeInput,
  policy: ReturnType<typeof buildWhatsAppConsentPolicy>,
  seed: PatientConsentSmokeFixtureSeed,
) {
  const store = createInMemorySimulatedWhatsAppBookingStore({
    clinic: {
      id: input.clinicId,
      whatsappNumberE164: "+50370000001",
    },
    contacts: [
      {
        id: input.syntheticContactId,
        name: seed.contactName,
        phoneE164: "+50370000002",
      },
    ],
    links: seed.links,
    offers: [],
    options: [],
    patients: seed.patients,
  });
  const context = {
    clinicId: input.clinicId,
    contactId: input.syntheticContactId,
    identityId: `synthetic-identity:${input.clinicId}`,
  };
  const channelConsent =
    seed.channelConsentInteractionId === undefined
      ? null
      : await recordSyntheticChannelConsent(
          store,
          policy,
          input.clinicId,
          input.syntheticContactId,
          seed.channelConsentInteractionId,
        );
  return { channelConsent, context, store };
}

function recordSyntheticChannelConsent(
  store: ReturnType<typeof createInMemorySimulatedWhatsAppBookingStore>,
  policy: ReturnType<typeof buildWhatsAppConsentPolicy>,
  clinicId: string,
  contactId: string,
  interactionId: string,
) {
  return store.recordWhatsAppConsent({
    acceptedAt: SMOKE_NOW,
    acceptedRole: "contact",
    clinicId,
    contactId,
    declaration: "CONTINUAR",
    identityId: `synthetic-identity:${clinicId}`,
    interactionId,
    patientId: null,
    phoneE164: "+50370000002",
    policy,
    scope: "channel",
    status: "accepted",
  });
}

function createConsentHarness(
  initialPolicy: ReturnType<typeof buildWhatsAppConsentPolicy>,
) {
  let latest: WhatsAppConsentEvidence | null = null;
  let policy = initialPolicy;
  let recordCount = 0;
  const store: WhatsAppConsentStore = {
    async findLatestWhatsAppConsent() {
      return latest;
    },
    async readCurrentWhatsAppConsentPolicy() {
      return policy;
    },
    async recordWhatsAppConsent(input) {
      recordCount += 1;
      latest = {
        acceptedAt: input.acceptedAt,
        acceptedRole: input.acceptedRole,
        clinicId: input.clinicId,
        contactId: input.contactId,
        declaration: input.declaration,
        id: `synthetic-consent:${recordCount}`,
        identityId: input.identityId,
        interactionId: input.interactionId,
        patientId: input.patientId,
        phoneE164: input.phoneE164,
        privacyVersion: input.policy.privacyVersion,
        provider: "kapso",
        scope: input.scope,
        status: input.status ?? "accepted",
        termsVersion: input.policy.termsVersion,
        textReference: input.policy.immutableTextReference,
      };
      return latest;
    },
  };
  return {
    get gate() {
      return createWhatsAppConsentGate(store);
    },
    get latest() {
      return latest;
    },
    get recordCount() {
      return recordCount;
    },
    set policy(value: ReturnType<typeof buildWhatsAppConsentPolicy>) {
      policy = value;
    },
  };
}
