import { randomUUID } from "node:crypto";

import { isAdultPatient } from "~/domain/patient";
import { canAuthorSelfManageAppointment } from "~/server/application/appointment-self-management";
import type { ConversationEscalationTrigger } from "~/server/application/conversation-escalations";
import {
  buildWhatsAppConsentPolicy,
  isWhatsAppGuardianDeclaration,
  type WhatsAppConsentEvidence,
  type WhatsAppConsentSafeRoute,
} from "~/domain/whatsapp-consent";
import type { WhatsAppConsentStore } from "~/server/application/whatsapp-consent";
import type {
  AudioContentType,
  AudioTranscriber,
} from "~/server/integrations/audio-transcriber";
import type { WhatsAppProvider } from "./whatsapp-provider";
import {
  notifySecretaryOfEscalation,
  type WhatsAppHumanTakeoverRecord,
} from "./whatsapp-human-takeover";

export {
  activateWhatsAppHumanTakeover,
  isWhatsAppHumanTakeoverActive,
} from "./whatsapp-human-takeover";
export type {
  WhatsAppHumanTakeoverRecord,
  WhatsAppHumanTakeoverStore,
} from "./whatsapp-human-takeover";

const RESERVATION_DURATION_MS = 10 * 60_000;

export type SimulatedWhatsAppInboundMessage = {
  from: string;
  id: string;
  text: string;
  to: string;
};

export type SimulatedWhatsAppVoiceNote = {
  audio: Uint8Array;
  contentType: string;
  from: string;
  id: string;
  to: string;
};

export type WhatsAppMessageOrigin = "text" | "voice";

export type WhatsAppBookingResponse =
  | { kind: "contact-not-found"; text: string }
  | {
      kind: "patient-selection-required";
      patients: PatientSummary[];
      text: string;
    }
  | { id: string; kind: "appointment-cancelled"; text: string }
  | {
      id: string;
      kind: "appointment-rescheduled";
      startsAt: Date;
      text: string;
    }
  | { id: string; kind: "appointment-escalated"; text: string }
  | { kind: "appointment-unavailable"; text: string }
  | { kind: "conversation-silenced"; text: string }
  | { kind: "guardianship-pending"; text: string }
  | { kind: "urgent-protocol"; text: string }
  | { kind: "patient-selected"; patientId: string; text: string }
  | { kind: "public-information"; offers: PublicOffer[]; text: string }
  | { kind: "care-options"; options: Date[]; text: string }
  | {
      expiresAt: Date;
      kind: "reservation-held";
      reservationId: string;
      text: string;
    }
  | {
      id: string;
      kind: "appointment-confirmed";
      origin: "reservation";
      patientId: string;
      text: string;
    }
  | { kind: "patient-registered"; patientId: string; text: string }
  | { kind: "invalid-request"; text: string };

export type PatientSummary = {
  birthDate: string;
  id: string;
  name: string;
};

export type PublicOffer = {
  doctorId: string;
  doctorName: string;
  id: string;
  priceUsd: string;
  serviceName: string;
};

export type BookingConversation = {
  agendaStopped: boolean;
  escalationId: string | null;
  lastInboundOrigin: WhatsAppMessageOrigin;
  misunderstandingCount: number;
  reservationId: string | null;
  selectedOfferId: string | null;
  selectedPatientId: string | null;
};

type AppointmentSelfManagementResult =
  | { id: string; kind: "cancelled" }
  | { id: string; kind: "escalated" }
  | { id: string; kind: "rescheduled"; startsAt: Date }
  | { kind: "unavailable" };

export type SimulatedWhatsAppBookingStore = WhatsAppConsentStore & {
  beginResolvedMessage?(input: {
    clinicId: string;
    contactId: string;
    id: string;
    origin: WhatsAppMessageOrigin;
  }): Promise<{ duplicate: WhatsAppBookingResponse | null }>;
  beginMessage(input: {
    from: string;
    id: string;
    origin: WhatsAppMessageOrigin;
    to: string;
  }): Promise<
    | {
        contactId: string;
        clinicId: string;
        identityId?: string;
        duplicate: WhatsAppBookingResponse | null;
      }
    | undefined
  >;
  completeMessage(input: {
    clinicId: string;
    id: string;
    response: WhatsAppBookingResponse;
  }): Promise<void>;
  createConversationEscalation(input: {
    clinicId: string;
    contactId: string;
    messageId?: string;
    now: Date;
    lastInboundOrigin?: WhatsAppMessageOrigin;
    sourceMessageType?: string;
    trigger: ConversationEscalationTrigger;
  }): Promise<{
    created?: boolean;
    id: string;
    notificationSent?: boolean;
    secretaryPhoneE164: string | null;
  }>;
  openHumanTakeover(input: {
    clinicId: string;
    contactId: string;
    messageId: string;
    messageType: string;
    now: Date;
    trigger: Extract<
      ConversationEscalationTrigger,
      "business-app" | "unsupported-message"
    >;
  }): Promise<WhatsAppHumanTakeoverRecord>;
  isVoiceTranscriptionEnabled(input: { clinicId: string }): Promise<boolean>;
  markConversationEscalationNotificationSent?(input: {
    clinicId: string;
    escalationId: string;
    sentAt: Date;
  }): Promise<void>;
  notifySecretaryOfConversationEscalation?(input: {
    clinicId: string;
    escalationId: string;
    recipientPhoneE164: string;
    trigger: ConversationEscalationTrigger;
  }): Promise<void>;
  recordUrgencyEvent(input: {
    clinicId: string;
    contactId: string;
    messageId?: string;
    now: Date;
  }): Promise<void>;
  confirmReservation(input: {
    clinicId: string;
    contactId: string;
    messageId: string;
    now: Date;
    reservationId: string;
  }): Promise<
    { id: string; origin: "reservation"; patientId: string } | undefined
  >;
  cancelAppointment(input: {
    appointmentId: string;
    clinicId: string;
    contactId: string;
    now: Date;
    patientId: string;
  }): Promise<AppointmentSelfManagementResult>;
  getConversation(input: {
    clinicId: string;
    contactId: string;
  }): Promise<BookingConversation>;
  listCareOptions(input: {
    clinicId: string;
    contactId: string;
    offerId: string;
    on: string;
    patientId: string;
    now: Date;
  }): Promise<Date[] | undefined>;
  listLinkedPatients(input: {
    clinicId: string;
    contactId: string;
  }): Promise<PatientSummary[]>;
  listPublicOffers(input: { clinicId: string }): Promise<PublicOffer[]>;
  registerAdult(input: {
    birthDate: string;
    clinicId: string;
    contactId: string;
    dui: string;
    messageId: string;
    name: string;
    now: Date;
  }): Promise<PatientSummary>;
  registerMinor(input: {
    birthDate: string;
    clinicId: string;
    contactId: string;
    declaration: string;
    guardianDui: string;
    messageId: string;
    name: string;
    now: Date;
  }): Promise<PatientSummary>;
  saveConversation(input: {
    clinicId: string;
    contactId: string;
    conversation: BookingConversation;
  }): Promise<void>;
  suppressPendingReminderDeliveries?(input: {
    clinicId: string;
    contactId: string;
    now: Date;
  }): Promise<number>;
  reactivatePendingWhatsAppDeliveries?(input: {
    clinicId: string;
    consentReference: string;
    contactId: string;
    now: Date;
  }): Promise<number>;
  holdReservation(input: {
    clinicId: string;
    contactId: string;
    messageId: string;
    now: Date;
    offerId: string;
    patientId: string;
    startsAt: Date;
  }): Promise<{ expiresAt: Date; id: string } | undefined>;
  rescheduleAppointment(input: {
    appointmentId: string;
    clinicId: string;
    contactId: string;
    now: Date;
    patientId: string;
    startsAt: Date;
  }): Promise<AppointmentSelfManagementResult>;
};

/**
 * Caso de uso que conecta el adaptador simulado con Asclepio. La Agenda se
 * consulta exclusivamente mediante el puerto: este flujo no calcula espacios.
 */
export async function processSimulatedWhatsAppMessage(
  input: SimulatedWhatsAppInboundMessage,
  store: SimulatedWhatsAppBookingStore,
  now = new Date(),
  replyProvider?: Pick<WhatsAppProvider, "sendConversationReply">,
): Promise<WhatsAppBookingResponse> {
  const normalized = {
    ...input,
    from: normalizeE164Phone(input.from),
    origin: "text" as const,
    to: normalizeE164Phone(input.to),
  };
  const received = await store.beginMessage(normalized);
  if (received === undefined) {
    return contactNotFound();
  }
  if (received.duplicate !== null) return received.duplicate;

  const response = await processReceivedMessage(
    {
      messageId: normalized.id,
      origin: normalized.origin,
      text: normalized.text,
    },
    received,
    store,
    now,
  );
  await store.completeMessage({
    clinicId: received.clinicId,
    id: normalized.id,
    response,
  });
  await sendConversationReply(replyProvider, {
    clinicId: received.clinicId,
    idempotencyKey: normalized.id,
    recipientPhoneE164: normalized.from,
    text: response.text,
  });
  return response;
}

/**
 * Ejecuta el mismo diálogo administrativo para un mensaje ya resuelto por un
 * adaptador real. La identidad, la deduplicación y el envío quedan fuera de
 * este caso de uso; aquí solo se entrega el Contacto autorizado a Asclepio.
 */
export async function processWhatsAppTextForContact(
  input: {
    clinicId: string;
    contactId: string;
    identityId?: string;
    messageId: string;
    text: string;
  },
  store: SimulatedWhatsAppBookingStore,
  now = new Date(),
): Promise<WhatsAppBookingResponse> {
  const received = await store.beginResolvedMessage?.({
    clinicId: input.clinicId,
    contactId: input.contactId,
    id: input.messageId,
    origin: "text",
  });
  if (received?.duplicate !== undefined && received.duplicate !== null) {
    return received.duplicate;
  }

  const response = await processReceivedMessage(
    { messageId: input.messageId, origin: "text", text: input.text },
    input,
    store,
    now,
  );
  if (received !== undefined) {
    await store.completeMessage({
      clinicId: input.clinicId,
      id: input.messageId,
      response,
    });
  }
  return response;
}

/**
 * Ruta segura para urgencias y atención humana mientras el gate sigue
 * pendiente. No recibe comandos administrativos ni llama a la Agenda.
 */
export async function processWhatsAppConsentSafeRoute(
  input: {
    clinicId: string;
    contactId: string;
    messageId: string;
    route: WhatsAppConsentSafeRoute;
    text: string;
  },
  store: SimulatedWhatsAppBookingStore,
  now = new Date(),
): Promise<{ text: string }> {
  const context = { clinicId: input.clinicId, contactId: input.contactId };
  await store.suppressPendingReminderDeliveries?.({
    ...context,
    now,
  });
  const conversation = await store.getConversation(context);
  const trigger =
    input.route === "human-request" ? "human-request" : "frustration";
  if (conversation.escalationId !== null) {
    const escalation = await store.createConversationEscalation({
      ...context,
      messageId: input.messageId,
      now,
      trigger,
    });
    await notifySecretaryOfEscalation(
      store,
      escalation,
      input.clinicId,
      trigger,
    );
    return conversationSilenced();
  }
  if (conversation.agendaStopped) {
    return conversationSilenced();
  }
  if (input.route === "urgency") {
    await store.recordUrgencyEvent({
      ...context,
      messageId: input.messageId,
      now,
    });
    await store.saveConversation({
      ...context,
      conversation: {
        ...conversation,
        agendaStopped: true,
        misunderstandingCount: 0,
      },
    });
    return urgentProtocol();
  }

  const escalation = await store.createConversationEscalation({
    ...context,
    messageId: input.messageId,
    now,
    trigger,
  });
  await notifySecretaryOfEscalation(store, escalation, input.clinicId, trigger);
  return conversationSilenced();
}

/**
 * Procesa una nota de voz sin conservar el audio ni el texto transcrito. Una
 * falla siempre se deriva a una persona antes de que Asclepio ejecute agenda.
 */
export async function processSimulatedWhatsAppVoiceNote(
  input: SimulatedWhatsAppVoiceNote,
  store: SimulatedWhatsAppBookingStore,
  transcriber: AudioTranscriber,
  now = new Date(),
  replyProvider?: Pick<WhatsAppProvider, "sendConversationReply">,
): Promise<WhatsAppBookingResponse> {
  const normalized = {
    ...input,
    from: normalizeE164Phone(input.from),
    origin: "voice" as const,
    to: normalizeE164Phone(input.to),
  };
  const received = await store.beginMessage(normalized);
  if (received === undefined) return contactNotFound();
  if (received.duplicate !== null) return received.duplicate;

  const response = !(await store.isVoiceTranscriptionEnabled(received))
    ? await escalateVoiceNote(
        received,
        store,
        now,
        "voice-transcription-disabled",
        normalized.id,
      )
    : await transcribeVoiceNote(normalized, received, store, transcriber, now);
  await store.completeMessage({
    clinicId: received.clinicId,
    id: normalized.id,
    response,
  });
  await sendConversationReply(replyProvider, {
    clinicId: received.clinicId,
    idempotencyKey: normalized.id,
    recipientPhoneE164: normalized.from,
    text: response.text,
  });
  return response;
}

async function sendConversationReply(
  provider: Pick<WhatsAppProvider, "sendConversationReply"> | undefined,
  input: Parameters<WhatsAppProvider["sendConversationReply"]>[0],
) {
  if (provider === undefined || input.text.length === 0) return;
  await provider.sendConversationReply(input);
}

async function transcribeVoiceNote(
  input: SimulatedWhatsAppVoiceNote & { origin: "voice" },
  context: { clinicId: string; contactId: string },
  store: SimulatedWhatsAppBookingStore,
  transcriber: AudioTranscriber,
  now: Date,
) {
  const contentType = transcriberContentType(input.contentType);
  if (
    contentType === undefined ||
    input.audio.byteLength === 0 ||
    input.audio.byteLength > 25 * 1024 * 1024
  ) {
    return escalateVoiceNote(
      context,
      store,
      now,
      "voice-transcription-failed",
      input.id,
    );
  }
  try {
    const text = (
      await transcriber.transcribe({
        audio: input.audio,
        contentType,
        model: "gpt-transcribe",
      })
    ).trim();
    if (text.length === 0 || text.length > 1_000) {
      return escalateVoiceNote(
        context,
        store,
        now,
        "voice-transcription-failed",
      );
    }
    const response = await processReceivedMessage(
      { ...input, messageId: input.id, text },
      context,
      store,
      now,
    );
    return response.kind === "invalid-request"
      ? escalateVoiceNote(
          context,
          store,
          now,
          "voice-transcription-failed",
          input.id,
        )
      : response;
  } catch {
    return escalateVoiceNote(
      context,
      store,
      now,
      "voice-transcription-failed",
      input.id,
    );
  }
}

async function escalateVoiceNote(
  context: { clinicId: string; contactId: string },
  store: SimulatedWhatsAppBookingStore,
  now: Date,
  trigger: Extract<
    ConversationEscalationTrigger,
    "voice-transcription-disabled" | "voice-transcription-failed"
  >,
  messageId?: string,
) {
  const escalation = await store.createConversationEscalation({
    ...context,
    messageId,
    now,
    lastInboundOrigin: "voice",
    trigger,
  });
  await notifySecretaryOfEscalation(
    store,
    escalation,
    context.clinicId,
    trigger,
  );
  return conversationSilenced();
}

function transcriberContentType(
  contentType: string,
): AudioContentType | undefined {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  switch (mediaType) {
    case "audio/ogg":
    case "audio/opus":
      return mediaType;
    case "audio/mpeg":
    case "audio/mp4":
    case "audio/wav":
    case "audio/webm":
      return mediaType;
    default:
      return undefined;
  }
}

async function processReceivedMessage(
  input: {
    messageId: string;
    origin: WhatsAppMessageOrigin;
    text: string;
  },
  received: { clinicId: string; contactId: string; identityId?: string },
  store: SimulatedWhatsAppBookingStore,
  now: Date,
) {
  await store.suppressPendingReminderDeliveries?.({
    clinicId: received.clinicId,
    contactId: received.contactId,
    now,
  });

  return processMessage(
    input.text,
    received,
    store,
    now,
    input.origin,
    input.messageId,
  );
}

async function processMessage(
  text: string,
  context: { clinicId: string; contactId: string; identityId?: string },
  store: SimulatedWhatsAppBookingStore,
  now: Date,
  origin: WhatsAppMessageOrigin,
  messageId: string,
): Promise<WhatsAppBookingResponse> {
  const [command, ...arguments_] = text.trim().split(/\s+/);
  const conversation = {
    ...(await store.getConversation(context)),
    lastInboundOrigin: origin,
  };
  await store.saveConversation({ ...context, conversation });
  if (conversation.escalationId !== null || conversation.agendaStopped)
    return conversationSilenced();
  if (indicatesUrgency(text)) {
    await store.recordUrgencyEvent({ ...context, messageId, now });
    await store.saveConversation({
      ...context,
      conversation: {
        ...conversation,
        agendaStopped: true,
        misunderstandingCount: 0,
      },
    });
    return urgentProtocol();
  }
  const trigger = escalationTrigger(text);
  if (trigger !== undefined) {
    const escalation = await store.createConversationEscalation({
      ...context,
      messageId,
      now,
      lastInboundOrigin: origin,
      trigger,
    });
    await notifySecretaryOfEscalation(
      store,
      escalation,
      context.clinicId,
      trigger,
    );
    return conversationSilenced();
  }
  const response: WhatsAppBookingResponse =
    await (async (): Promise<WhatsAppBookingResponse> => {
      switch (command?.toLowerCase()) {
        case "info":
        case "servicios": {
          const offers = await store.listPublicOffers({
            clinicId: context.clinicId,
          });
          return {
            kind: "public-information",
            offers,
            text:
              offers.length === 0
                ? "No hay servicios disponibles."
                : "Servicios disponibles.",
          };
        }
        case "paciente": {
          const patientId = arguments_[0];
          const patients = await store.listLinkedPatients(context);
          const selectedPatient = selectLinkedPatient(patients, patientId);
          if (selectedPatient === undefined) {
            return patientSelectionRequired(patients);
          }
          await store.saveConversation({
            ...context,
            conversation: {
              ...conversation,
              reservationId: null,
              selectedPatientId: selectedPatient.id,
            },
          });
          return {
            kind: "patient-selected",
            patientId: selectedPatient.id,
            text: "Paciente seleccionado.",
          };
        }
        case "registrar": {
          const registration = parseAdultRegistration(text);
          const minorRegistration = parseMinorRegistration(text);
          if (registration === undefined && minorRegistration === undefined)
            return invalidRequest();
          if (registration !== undefined) {
            if (!isAdultPatient(registration.birthDate, now))
              return invalidRequest();
            const patient = await store.registerAdult({
              ...context,
              ...registration,
              messageId,
              now,
            });
            return {
              kind: "patient-registered",
              patientId: patient.id,
              text: "Paciente registrado. Escriba paciente para elegir un Paciente antes de consultar o gestionar una Cita.",
            };
          }
          if (
            minorRegistration === undefined ||
            isAdultPatient(minorRegistration.birthDate, now) ||
            isFutureBirthDate(minorRegistration.birthDate, now)
          ) {
            return invalidRequest();
          }
          await store.registerMinor({
            ...context,
            ...minorRegistration,
            messageId,
            now,
          });
          const escalation = await store.createConversationEscalation({
            ...context,
            messageId,
            now,
            lastInboundOrigin: origin,
            trigger: "guardianship-pending",
          });
          await notifySecretaryOfEscalation(
            store,
            escalation,
            context.clinicId,
            "guardianship-pending",
          );
          return guardianshipPending();
        }
        case "opciones": {
          const patients = await store.listLinkedPatients(context);
          if (
            conversation.selectedPatientId === null ||
            !patients.some(
              (patient) => patient.id === conversation.selectedPatientId,
            )
          )
            return patientSelectionRequired(patients);
          const [offerId, on] = arguments_;
          if (offerId === undefined || on === undefined || !validLocalDate(on))
            return invalidRequest();
          const options = await store.listCareOptions({
            ...context,
            now,
            offerId,
            on,
            patientId: conversation.selectedPatientId,
          });
          if (options === undefined) return invalidRequest();
          await store.saveConversation({
            ...context,
            conversation: { ...conversation, selectedOfferId: offerId },
          });
          return {
            kind: "care-options",
            options,
            text: "Opciones calculadas por la Agenda.",
          };
        }
        case "reservar": {
          const patients = await store.listLinkedPatients(context);
          if (
            conversation.selectedPatientId === null ||
            !patients.some(
              (patient) => patient.id === conversation.selectedPatientId,
            )
          )
            return patientSelectionRequired(patients);
          if (conversation.selectedOfferId === null) return invalidRequest();
          const startsAt = parseFutureInstant(arguments_[0], now);
          if (startsAt === undefined) return invalidRequest();
          const reservation = await store.holdReservation({
            ...context,
            messageId,
            now,
            offerId: conversation.selectedOfferId,
            patientId: conversation.selectedPatientId,
            startsAt,
          });
          if (reservation === undefined) return invalidRequest();
          await store.saveConversation({
            ...context,
            conversation: { ...conversation, reservationId: reservation.id },
          });
          return {
            expiresAt: reservation.expiresAt,
            kind: "reservation-held",
            reservationId: reservation.id,
            text: "Espacio reservado temporalmente. Responda confirmar.",
          };
        }
        case "confirmar": {
          if (conversation.reservationId === null) return invalidRequest();
          const patients = await store.listLinkedPatients(context);
          if (
            conversation.selectedPatientId === null ||
            !patients.some(
              (patient) => patient.id === conversation.selectedPatientId,
            )
          )
            return patientSelectionRequired(patients);
          const appointment = await store.confirmReservation({
            ...context,
            messageId,
            now,
            reservationId: conversation.reservationId,
          });
          if (appointment === undefined) return invalidRequest();
          await store.saveConversation({
            ...context,
            conversation: { ...conversation, reservationId: null },
          });
          return {
            ...appointment,
            kind: "appointment-confirmed",
            text: "Cita confirmada.",
          };
        }
        case "cancelar": {
          const patients = await store.listLinkedPatients(context);
          if (
            conversation.selectedPatientId === null ||
            !patients.some(
              (patient) => patient.id === conversation.selectedPatientId,
            )
          )
            return patientSelectionRequired(patients);
          const appointmentId = arguments_[0];
          if (appointmentId === undefined) return invalidRequest();
          const outcome = await store.cancelAppointment({
            ...context,
            appointmentId,
            now,
            patientId: conversation.selectedPatientId,
          });
          return selfManagementResponse(outcome, context, conversation, store);
        }
        case "reprogramar": {
          const patients = await store.listLinkedPatients(context);
          if (
            conversation.selectedPatientId === null ||
            !patients.some(
              (patient) => patient.id === conversation.selectedPatientId,
            )
          )
            return patientSelectionRequired(patients);
          const [appointmentId, rawStartsAt] = arguments_;
          const startsAt = parseFutureInstant(rawStartsAt, now);
          if (appointmentId === undefined || startsAt === undefined)
            return invalidRequest();
          const outcome = await store.rescheduleAppointment({
            ...context,
            appointmentId,
            now,
            patientId: conversation.selectedPatientId,
            startsAt,
          });
          return selfManagementResponse(outcome, context, conversation, store);
        }
        default:
          return invalidRequest();
      }
    })();
  if (response.kind === "invalid-request") {
    const misunderstandingCount = conversation.misunderstandingCount + 1;
    if (misunderstandingCount < 2) {
      await store.saveConversation({
        ...context,
        conversation: { ...conversation, misunderstandingCount },
      });
      return response;
    }
    const escalation = await store.createConversationEscalation({
      ...context,
      messageId,
      now,
      lastInboundOrigin: origin,
      trigger: "misunderstanding",
    });
    await notifySecretaryOfEscalation(
      store,
      escalation,
      context.clinicId,
      "misunderstanding",
    );
    return conversationSilenced();
  }
  if (conversation.misunderstandingCount > 0) {
    const currentConversation = await store.getConversation(context);
    await store.saveConversation({
      ...context,
      conversation: { ...currentConversation, misunderstandingCount: 0 },
    });
  }
  return response;
}

async function selfManagementResponse(
  outcome: AppointmentSelfManagementResult,
  context: { clinicId: string; contactId: string },
  conversation: BookingConversation,
  store: Pick<SimulatedWhatsAppBookingStore, "saveConversation">,
): Promise<WhatsAppBookingResponse> {
  switch (outcome.kind) {
    case "cancelled":
      return {
        id: outcome.id,
        kind: "appointment-cancelled",
        text: "Cita cancelada.",
      };
    case "rescheduled":
      return {
        id: outcome.id,
        kind: "appointment-rescheduled",
        startsAt: outcome.startsAt,
        text: "Cita reprogramada.",
      };
    case "escalated":
      await store.saveConversation({
        ...context,
        conversation: { ...conversation, escalationId: outcome.id },
      });
      return { kind: "conversation-silenced", text: "" };
    case "unavailable":
      return {
        kind: "appointment-unavailable",
        text: "La Agenda ya no autoriza este cambio.",
      };
  }
}

function conversationSilenced(): WhatsAppBookingResponse {
  return { kind: "conversation-silenced", text: "" };
}

function guardianshipPending(): WhatsAppBookingResponse {
  return {
    kind: "guardianship-pending",
    text: "La Clínica debe verificar la representación autorizada antes de gestionar datos del Paciente.",
  };
}

function escalationTrigger(
  text: string,
):
  | Extract<ConversationEscalationTrigger, "human-request" | "frustration">
  | undefined {
  if (
    /\b(hablar\s+con\s+(una\s+)?persona|atenci[oó]n\s+humana|humano|secretaria)\b/i.test(
      text,
    )
  ) {
    return "human-request";
  }
  if (/\b(no\s+sirve|no\s+entiendes|in[úu]til|frustrad[oa])\b/i.test(text)) {
    return "frustration";
  }
  return undefined;
}

function indicatesUrgency(text: string) {
  return /\b(emergencia|urgencia)\b/i.test(text);
}

function urgentProtocol(): WhatsAppBookingResponse {
  return {
    kind: "urgent-protocol",
    text: "Si es una emergencia médica, llame al 911 ahora.",
  };
}

function patientSelectionRequired(
  patients: PatientSummary[],
): WhatsAppBookingResponse {
  return {
    kind: "patient-selection-required",
    patients,
    text:
      patients.length === 0
        ? "No hay Pacientes disponibles para este Contacto. Si se registró un menor, espere a que la Clínica verifique la representación."
        : `Seleccione explícitamente el Paciente respondiendo paciente y su número:\n${patients
            .map(
              (patient, index) =>
                `${index + 1}. ${patient.name} (${patient.birthDate})`,
            )
            .join("\n")}`,
  };
}

function selectLinkedPatient(
  patients: PatientSummary[],
  selection: string | undefined,
) {
  if (selection === undefined) return undefined;
  const byId = patients.find((patient) => patient.id === selection);
  if (byId !== undefined) return byId;
  if (!/^\d+$/.test(selection)) return undefined;
  return patients[Number.parseInt(selection, 10) - 1];
}

function contactNotFound(): WhatsAppBookingResponse {
  return {
    kind: "contact-not-found",
    text: "No podemos continuar con esta solicitud.",
  };
}

function invalidRequest(): WhatsAppBookingResponse {
  return {
    kind: "invalid-request",
    text: "No entendí la solicitud. Escriba info para conocer los servicios.",
  };
}

function parseAdultRegistration(text: string) {
  const match =
    /^registrar\s+adulto\|([^|]+)\|([^|]+)\|(\d{4}-\d{2}-\d{2})$/i.exec(
      text.trim(),
    );
  if (match === null) return undefined;
  const [, rawName, rawDui, birthDate] = match;
  const name = rawName?.trim().replace(/\s+/g, " ");
  const dui = rawDui?.trim();
  if (
    name === undefined ||
    name.length === 0 ||
    dui === undefined ||
    !/^\d{8}-\d$/.test(dui) ||
    birthDate === undefined ||
    !validLocalDate(birthDate)
  )
    return undefined;
  return { birthDate, dui, name };
}

function parseMinorRegistration(text: string) {
  const match =
    /^registrar\s+menor\|([^|]+)\|([^|]+)\|(\d{4}-\d{2}-\d{2})\|([^|]+)$/i.exec(
      text.trim(),
    );
  if (match === null) return undefined;
  const [, rawName, rawGuardianDui, birthDate, rawDeclaration] = match;
  const name = rawName?.trim().replace(/\s+/g, " ");
  const guardianDui = rawGuardianDui?.trim();
  const declaration = rawDeclaration?.trim();
  if (
    name === undefined ||
    name.length === 0 ||
    guardianDui === undefined ||
    !/^\d{8}-\d$/.test(guardianDui) ||
    birthDate === undefined ||
    !validLocalDate(birthDate) ||
    declaration === undefined ||
    !isWhatsAppGuardianDeclaration(declaration)
  )
    return undefined;
  return { birthDate, declaration, guardianDui, name };
}

function parseFutureInstant(value: string | undefined, now: Date) {
  if (
    value === undefined ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ||
    date <= now ||
    date.getUTCMinutes() % 5 !== 0
    ? undefined
    : date;
}

function validLocalDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function isFutureBirthDate(birthDate: string, now: Date) {
  return new Date(`${birthDate}T00:00:00.000Z`) > now;
}

function normalizeE164Phone(value: string) {
  const normalized = value.trim().replace(/[()\s.-]/g, "");
  if (!/^\+[1-9]\d{1,14}$/.test(normalized))
    throw new Error("El teléfono debe ser un número E.164 válido");
  return normalized;
}

type InMemoryPatient = PatientSummary & { dui?: string };

type InMemoryContactPatientLink = {
  contactId: string;
  guardianDeclaration?: string;
  guardianDui?: string;
  guardianshipVerificationStatus?: "pending" | "verified";
  patientId: string;
  relationship?: "contact" | "tutor";
};

function hasManageableInMemoryPatientLink(
  input: {
    links: InMemoryContactPatientLink[];
    patients: InMemoryPatient[];
  },
  contactId: string,
  patientId: string,
  now: Date,
) {
  const link = input.links.find(
    (candidate) =>
      candidate.contactId === contactId && candidate.patientId === patientId,
  );
  const patient = input.patients.find(
    (candidate) => candidate.id === patientId,
  );
  return (
    link !== undefined &&
    patient !== undefined &&
    isManageablePatientLink(link, patient, now)
  );
}

function isManageablePatientLink(
  link: InMemoryContactPatientLink,
  patient: InMemoryPatient,
  now: Date,
) {
  return link.relationship === "tutor"
    ? link.guardianshipVerificationStatus === "verified" &&
        link.guardianDui !== undefined &&
        /^\d{8}-\d$/.test(link.guardianDui) &&
        isWhatsAppGuardianDeclaration(link.guardianDeclaration ?? "")
    : (link.relationship === undefined || link.relationship === "contact") &&
        isAdultPatient(patient.birthDate, now);
}

function inMemoryMessageKey(
  clinicId: string,
  contactId: string,
  messageId: string,
) {
  return `${clinicId}:${contactId}:${messageId}`;
}

/** Adaptador simulado en memoria para probar el seam del caso de uso. */
export function createInMemorySimulatedWhatsAppBookingStore(input: {
  clinic: {
    escalationNotificationsEnabled?: boolean;
    escalationSecretaryPhoneE164?: string;
    id: string;
    voiceTranscriptionEnabled?: boolean;
    whatsappNumberE164: string;
  };
  contacts: { id: string; name: string; phoneE164: string }[];
  links: InMemoryContactPatientLink[];
  offers: PublicOffer[];
  options: Date[];
  patients: InMemoryPatient[];
}) {
  const conversations = new Map<string, BookingConversation>();
  const messages = new Map<string, WhatsAppBookingResponse>();
  const messageOrigins = new Map<string, WhatsAppMessageOrigin>();
  const registeredPatientsByMessage = new Map<string, PatientSummary>();
  const urgencyEventsByMessage = new Set<string>();
  const escalationsByMessage = new Map<
    string,
    {
      id: string;
      secretaryPhoneE164: string | null;
      sourceMessageType: string | null;
      trigger: ConversationEscalationTrigger;
    }
  >();
  const escalationsById = new Map<
    string,
    {
      id: string;
      secretaryPhoneE164: string | null;
      sourceMessageType: string | null;
      trigger: ConversationEscalationTrigger;
    }
  >();
  const notifiedEscalations = new Set<string>();
  const reservations: Array<{
    contactId: string;
    expiresAt: Date;
    id: string;
    offerId: string;
    patientId: string;
    sourceMessageId: string;
    startsAt: Date;
  }> = [];
  const appointments: Array<{
    authorContactId: string;
    id: string;
    origin: "reservation";
    patientId: string;
    sourceMessageId: string;
    startsAt: Date;
    status: "cancelled" | "confirmed";
  }> = [];
  const appointmentEvents: Array<{
    appointmentId: string;
    type: "cancelled" | "rescheduled" | "self-management-escalated";
  }> = [];
  const escalations: Array<{
    action: "cancel" | "reschedule";
    appointmentId: string;
    contactId: string;
  }> = [];
  const conversationEscalations: Array<{
    contactId: string;
    sourceMessageType?: string;
    trigger: ConversationEscalationTrigger;
  }> = [];
  const conversationEvents: Array<{
    contactId: string;
    type: "urgency-protocol";
  }> = [];
  const consents: WhatsAppConsentEvidence[] = [];
  const consentPolicy = buildWhatsAppConsentPolicy("1.0");
  const store: SimulatedWhatsAppBookingStore & {
    appointments: typeof appointments;
    conversationEscalations: typeof conversationEscalations;
    conversationEvents: typeof conversationEvents;
    messageOrigins: typeof messageOrigins;
    appointmentEvents: typeof appointmentEvents;
    escalations: typeof escalations;
    consents: typeof consents;
    patients: InMemoryPatient[];
    reservations: typeof reservations;
  } = {
    appointments,
    conversationEscalations,
    conversationEvents,
    messageOrigins,
    appointmentEvents,
    escalations,
    consents,
    patients: input.patients,
    reservations,
    async beginMessage(message) {
      if (message.to !== input.clinic.whatsappNumberE164) return undefined;
      const contact = input.contacts.find(
        (candidate) => candidate.phoneE164 === message.from,
      );
      if (contact === undefined) return undefined;
      const duplicate = messages.get(message.id) ?? null;
      if (duplicate === null) messageOrigins.set(message.id, message.origin);
      return {
        clinicId: input.clinic.id,
        contactId: contact.id,
        identityId: `synthetic-identity:${contact.id}`,
        duplicate,
      };
    },
    async completeMessage({ id, response }) {
      messages.set(id, response);
    },
    async beginResolvedMessage({ id, origin }) {
      const duplicate = messages.get(id) ?? null;
      if (duplicate === null) messageOrigins.set(id, origin);
      return { duplicate };
    },
    async createConversationEscalation({
      clinicId,
      contactId,
      lastInboundOrigin,
      messageId,
      trigger,
      sourceMessageType,
    }) {
      const conversationKey = `${clinicId}:${contactId}`;
      const conversation = conversations.get(conversationKey) ?? {
        agendaStopped: false,
        escalationId: null,
        lastInboundOrigin: "text" as const,
        misunderstandingCount: 0,
        reservationId: null,
        selectedOfferId: null,
        selectedPatientId: null,
      };
      if (conversation.escalationId !== null) {
        const existing = escalationsById.get(conversation.escalationId);
        if (existing === undefined) {
          throw new Error("El takeover de la conversación no existe");
        }
        return {
          ...existing,
          created: false,
          notificationSent: notifiedEscalations.has(existing.id),
        };
      }
      const messageKey =
        messageId === undefined
          ? undefined
          : inMemoryMessageKey(clinicId, contactId, messageId);
      const existing =
        messageKey === undefined
          ? undefined
          : escalationsByMessage.get(messageKey);
      if (existing !== undefined) {
        if (existing.trigger !== trigger) {
          throw new Error("La interacción ya inició otro Escalamiento");
        }
        return {
          ...existing,
          created: false,
          notificationSent: notifiedEscalations.has(existing.id),
        };
      }
      const escalation = {
        id: randomUUID(),
        secretaryPhoneE164:
          input.clinic.escalationNotificationsEnabled === true
            ? (input.clinic.escalationSecretaryPhoneE164 ?? null)
            : null,
        sourceMessageType: sourceMessageType ?? null,
        trigger,
      };
      conversationEscalations.push({
        contactId,
        ...(sourceMessageType === undefined ? {} : { sourceMessageType }),
        trigger,
      });
      escalationsById.set(escalation.id, escalation);
      if (messageKey !== undefined)
        escalationsByMessage.set(messageKey, escalation);
      conversations.set(conversationKey, {
        ...conversation,
        ...(lastInboundOrigin === undefined ? {} : { lastInboundOrigin }),
        escalationId: escalation.id,
      });
      return {
        ...escalation,
        created: true,
        notificationSent: false,
      };
    },
    async openHumanTakeover(input) {
      const key = `${input.clinicId}:${input.contactId}`;
      const conversation = conversations.get(key) ?? {
        agendaStopped: false,
        escalationId: null,
        lastInboundOrigin: "text" as const,
        misunderstandingCount: 0,
        reservationId: null,
        selectedOfferId: null,
        selectedPatientId: null,
      };
      if (conversation.escalationId !== null) {
        const existing = escalationsById.get(conversation.escalationId);
        if (existing === undefined) {
          throw new Error("El takeover de la conversación no existe");
        }
        return {
          created: false,
          id: existing.id,
          notificationSent: notifiedEscalations.has(existing.id),
          secretaryPhoneE164: existing.secretaryPhoneE164,
        };
      }
      const escalation = await store.createConversationEscalation({
        clinicId: input.clinicId,
        contactId: input.contactId,
        messageId: input.messageId,
        now: input.now,
        sourceMessageType: input.messageType,
        trigger: input.trigger,
      });
      conversations.set(key, {
        ...conversation,
        escalationId: escalation.id,
      });
      return {
        created: escalation.created === true,
        id: escalation.id,
        notificationSent: escalation.notificationSent === true,
        secretaryPhoneE164: escalation.secretaryPhoneE164,
      };
    },
    async markConversationEscalationNotificationSent({ escalationId }) {
      notifiedEscalations.add(escalationId);
    },
    async isVoiceTranscriptionEnabled() {
      return input.clinic.voiceTranscriptionEnabled === true;
    },
    async findLatestWhatsAppConsent({ clinicId, contactId }) {
      return (
        [...consents]
          .reverse()
          .find(
            (evidence) =>
              evidence.clinicId === clinicId &&
              evidence.contactId === contactId &&
              evidence.patientId === null &&
              evidence.scope === "contact",
          ) ?? null
      );
    },
    async readCurrentWhatsAppConsentPolicy() {
      return consentPolicy;
    },
    async recordWhatsAppConsent(record) {
      const duplicate = consents.find(
        (evidence) =>
          evidence.clinicId === record.clinicId &&
          evidence.provider === "kapso" &&
          evidence.interactionId === record.interactionId,
      );
      if (duplicate !== undefined) return duplicate;
      const evidence: WhatsAppConsentEvidence = {
        acceptedAt: record.acceptedAt,
        acceptedRole: "contact",
        actorIdentityId: null,
        clinicId: record.clinicId,
        contactId: record.contactId,
        declaration: record.declaration,
        id: randomUUID(),
        identityId: record.identityId,
        interactionId: record.interactionId,
        origin: "whatsapp_inbound",
        patientId: null,
        phoneE164: record.phoneE164,
        privacyVersion: record.policy.privacyVersion,
        provider: "kapso",
        sourcePatientId: null,
        scope: "contact",
        status: record.status ?? "accepted",
        termsVersion: record.policy.termsVersion,
        textReference: record.policy.immutableTextReference,
      };
      consents.push(evidence);
      return evidence;
    },
    async recordUrgencyEvent({ clinicId, contactId, messageId }) {
      if (messageId !== undefined) {
        const messageKey = inMemoryMessageKey(clinicId, contactId, messageId);
        if (urgencyEventsByMessage.has(messageKey)) return;
        urgencyEventsByMessage.add(messageKey);
      }
      conversationEvents.push({ contactId, type: "urgency-protocol" });
    },
    async getConversation({ clinicId, contactId }) {
      const key = `${clinicId}:${contactId}`;
      return (
        conversations.get(key) ?? {
          agendaStopped: false,
          escalationId: null,
          lastInboundOrigin: "text",
          misunderstandingCount: 0,
          reservationId: null,
          selectedOfferId: null,
          selectedPatientId: null,
        }
      );
    },
    async saveConversation({ clinicId, contactId, conversation }) {
      conversations.set(`${clinicId}:${contactId}`, conversation);
    },
    async listLinkedPatients({ contactId }) {
      return input.links
        .filter((link) => link.contactId === contactId)
        .flatMap((link) =>
          store.patients
            .filter(
              (patient) =>
                patient.id === link.patientId &&
                isManageablePatientLink(link, patient, new Date()),
            )
            .map(({ birthDate, id, name }) => ({ birthDate, id, name })),
        );
    },
    async listPublicOffers() {
      return input.offers;
    },
    async listCareOptions({ offerId }) {
      return input.offers.some((offer) => offer.id === offerId)
        ? input.options
        : undefined;
    },
    async registerAdult({
      birthDate,
      clinicId,
      contactId,
      dui,
      messageId,
      name,
    }) {
      const messageKey = inMemoryMessageKey(clinicId, contactId, messageId);
      const existing = registeredPatientsByMessage.get(messageKey);
      if (existing !== undefined) return existing;
      const patient = { birthDate, dui, id: randomUUID(), name };
      store.patients.push(patient);
      input.links.push({
        contactId,
        patientId: patient.id,
        relationship: "contact",
      });
      registeredPatientsByMessage.set(messageKey, patient);
      return patient;
    },
    async registerMinor({
      birthDate,
      clinicId,
      contactId,
      declaration,
      guardianDui,
      messageId,
      name,
    }) {
      const messageKey = inMemoryMessageKey(clinicId, contactId, messageId);
      const existing = registeredPatientsByMessage.get(messageKey);
      if (existing !== undefined) return existing;
      const patient = { birthDate, id: randomUUID(), name };
      store.patients.push(patient);
      input.links.push({
        contactId,
        guardianDeclaration: declaration,
        guardianDui,
        guardianshipVerificationStatus: "pending",
        patientId: patient.id,
        relationship: "tutor",
      });
      registeredPatientsByMessage.set(messageKey, patient);
      return patient;
    },
    async holdReservation({
      contactId,
      messageId,
      now,
      offerId,
      patientId,
      startsAt,
    }) {
      const existing = reservations.find(
        (candidate) => candidate.sourceMessageId === messageId,
      );
      if (existing !== undefined) return existing;
      if (!hasManageableInMemoryPatientLink(input, contactId, patientId, now))
        return undefined;
      if (
        !input.options.some((option) => option.valueOf() === startsAt.valueOf())
      )
        return undefined;
      const reservation = {
        contactId,
        expiresAt: new Date(now.valueOf() + RESERVATION_DURATION_MS),
        id: randomUUID(),
        offerId,
        patientId,
        sourceMessageId: messageId,
        startsAt,
      };
      reservations.push(reservation);
      return reservation;
    },
    async confirmReservation({ contactId, messageId, now, reservationId }) {
      const existing = appointments.find(
        (candidate) => candidate.sourceMessageId === messageId,
      );
      if (existing !== undefined) return existing;
      const reservation = reservations.find(
        (candidate) =>
          candidate.id === reservationId &&
          candidate.contactId === contactId &&
          candidate.expiresAt > now,
      );
      if (reservation === undefined) return undefined;
      if (
        !hasManageableInMemoryPatientLink(
          input,
          contactId,
          reservation.patientId,
          now,
        )
      )
        return undefined;
      const appointment = {
        authorContactId: contactId,
        id: randomUUID(),
        origin: "reservation" as const,
        patientId: reservation.patientId,
        sourceMessageId: messageId,
        startsAt: reservation.startsAt,
        status: "confirmed" as const,
      };
      appointments.push(appointment);
      return appointment;
    },
    async cancelAppointment({ appointmentId, contactId, now, patientId }) {
      if (!hasManageableInMemoryPatientLink(input, contactId, patientId, now))
        return { kind: "unavailable" };
      const appointment = appointments.find(
        (candidate) =>
          candidate.id === appointmentId &&
          candidate.patientId === patientId &&
          candidate.status === "confirmed",
      );
      if (appointment === undefined) return { kind: "unavailable" };
      if (!canAuthorSelfManageAppointment(appointment, contactId, now)) {
        escalations.push({ action: "cancel", appointmentId, contactId });
        appointmentEvents.push({
          appointmentId,
          type: "self-management-escalated",
        });
        return { id: appointmentId, kind: "escalated" };
      }
      appointment.status = "cancelled";
      appointmentEvents.push({ appointmentId, type: "cancelled" });
      return { id: appointmentId, kind: "cancelled" };
    },
    async rescheduleAppointment({
      appointmentId,
      contactId,
      now,
      patientId,
      startsAt,
    }) {
      if (!hasManageableInMemoryPatientLink(input, contactId, patientId, now))
        return { kind: "unavailable" };
      const appointment = appointments.find(
        (candidate) =>
          candidate.id === appointmentId &&
          candidate.patientId === patientId &&
          candidate.status === "confirmed",
      );
      if (appointment === undefined) return { kind: "unavailable" };
      if (!canAuthorSelfManageAppointment(appointment, contactId, now)) {
        escalations.push({ action: "reschedule", appointmentId, contactId });
        appointmentEvents.push({
          appointmentId,
          type: "self-management-escalated",
        });
        return { id: appointmentId, kind: "escalated" };
      }
      if (
        !input.options.some((option) => option.valueOf() === startsAt.valueOf())
      ) {
        return { kind: "unavailable" };
      }
      appointment.startsAt = startsAt;
      appointmentEvents.push({ appointmentId, type: "rescheduled" });
      return { id: appointmentId, kind: "rescheduled", startsAt };
    },
  };
  return store;
}
