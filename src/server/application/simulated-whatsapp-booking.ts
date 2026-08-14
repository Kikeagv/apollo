import { randomUUID } from "node:crypto";

import { canAuthorSelfManageAppointment } from "~/server/application/appointment-self-management";
import type { ConversationEscalationTrigger } from "~/server/application/conversation-escalations";
import type {
  AudioContentType,
  AudioTranscriber,
} from "~/server/integrations/audio-transcriber";

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

export type SimulatedWhatsAppBookingStore = {
  beginMessage(input: {
    from: string;
    id: string;
    origin: WhatsAppMessageOrigin;
    to: string;
  }): Promise<
    | {
        contactId: string;
        clinicId: string;
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
    now: Date;
    trigger: ConversationEscalationTrigger;
  }): Promise<{ id: string; secretaryPhoneE164: string | null }>;
  isVoiceTranscriptionEnabled(input: { clinicId: string }): Promise<boolean>;
  notifySecretaryOfConversationEscalation?(input: {
    clinicId: string;
    escalationId: string;
    recipientPhoneE164: string;
    trigger: ConversationEscalationTrigger;
  }): Promise<void>;
  recordUrgencyEvent(input: {
    clinicId: string;
    contactId: string;
    now: Date;
  }): Promise<void>;
  confirmReservation(input: {
    clinicId: string;
    contactId: string;
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
    name: string;
    now: Date;
  }): Promise<PatientSummary>;
  registerMinor(input: {
    birthDate: string;
    clinicId: string;
    contactId: string;
    guardianDui: string;
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
  holdReservation(input: {
    clinicId: string;
    contactId: string;
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
    normalized,
    received,
    store,
    now,
  );
  await store.completeMessage({
    clinicId: received.clinicId,
    id: normalized.id,
    response,
  });
  return response;
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
      )
    : await transcribeVoiceNote(normalized, received, store, transcriber, now);
  await store.completeMessage({
    clinicId: received.clinicId,
    id: normalized.id,
    response,
  });
  return response;
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
    return escalateVoiceNote(context, store, now, "voice-transcription-failed");
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
      { ...input, text },
      context,
      store,
      now,
    );
    return response.kind === "invalid-request"
      ? escalateVoiceNote(context, store, now, "voice-transcription-failed")
      : response;
  } catch {
    return escalateVoiceNote(context, store, now, "voice-transcription-failed");
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
) {
  const conversation = await store.getConversation(context);
  const escalation = await store.createConversationEscalation({
    ...context,
    now,
    trigger,
  });
  await store.saveConversation({
    ...context,
    conversation: {
      ...conversation,
      escalationId: escalation.id,
      lastInboundOrigin: "voice",
    },
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
  input: SimulatedWhatsAppInboundMessage & { origin: WhatsAppMessageOrigin },
  received: { clinicId: string; contactId: string },
  store: SimulatedWhatsAppBookingStore,
  now: Date,
) {
  await store.suppressPendingReminderDeliveries?.({
    clinicId: received.clinicId,
    contactId: received.contactId,
    now,
  });

  return processMessage(input.text, received, store, now, input.origin);
}

async function processMessage(
  text: string,
  context: { clinicId: string; contactId: string },
  store: SimulatedWhatsAppBookingStore,
  now: Date,
  origin: WhatsAppMessageOrigin,
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
    await store.recordUrgencyEvent({ ...context, now });
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
      now,
      trigger,
    });
    await store.saveConversation({
      ...context,
      conversation: { ...conversation, escalationId: escalation.id },
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
          if (
            patientId === undefined ||
            !patients.some((patient) => patient.id === patientId)
          ) {
            return patientSelectionRequired(patients);
          }
          await store.saveConversation({
            ...context,
            conversation: {
              ...conversation,
              reservationId: null,
              selectedPatientId: patientId,
            },
          });
          return {
            kind: "patient-selected",
            patientId,
            text: "Paciente seleccionado.",
          };
        }
        case "registrar": {
          const registration = parseAdultRegistration(text);
          const minorRegistration = parseMinorRegistration(text);
          if (registration === undefined && minorRegistration === undefined)
            return invalidRequest();
          const patient =
            registration !== undefined
              ? isAdult(registration.birthDate, now)
                ? await store.registerAdult({
                    ...context,
                    ...registration,
                    now,
                  })
                : undefined
              : minorRegistration !== undefined &&
                  !isAdult(minorRegistration.birthDate, now) &&
                  !isFutureBirthDate(minorRegistration.birthDate, now)
                ? await store.registerMinor({
                    ...context,
                    ...minorRegistration,
                    now,
                  })
                : undefined;
          if (patient === undefined) return invalidRequest();
          return {
            kind: "patient-registered",
            patientId: patient.id,
            text: "Paciente registrado. Seleccione explícitamente el Paciente para continuar.",
          };
        }
        case "opciones": {
          const patients = await store.listLinkedPatients(context);
          if (conversation.selectedPatientId === null)
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
          if (conversation.selectedPatientId === null)
            return patientSelectionRequired(patients);
          if (conversation.selectedOfferId === null) return invalidRequest();
          const startsAt = parseFutureInstant(arguments_[0], now);
          if (startsAt === undefined) return invalidRequest();
          const reservation = await store.holdReservation({
            ...context,
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
          const appointment = await store.confirmReservation({
            ...context,
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
          if (conversation.selectedPatientId === null) {
            return patientSelectionRequired(
              await store.listLinkedPatients(context),
            );
          }
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
          if (conversation.selectedPatientId === null) {
            return patientSelectionRequired(
              await store.listLinkedPatients(context),
            );
          }
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
      now,
      trigger: "misunderstanding",
    });
    await store.saveConversation({
      ...context,
      conversation: { ...conversation, escalationId: escalation.id },
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

async function notifySecretaryOfEscalation(
  store: SimulatedWhatsAppBookingStore,
  escalation: { id: string; secretaryPhoneE164: string | null },
  clinicId: string,
  trigger: ConversationEscalationTrigger,
) {
  if (escalation.secretaryPhoneE164 === null) return;
  await store.notifySecretaryOfConversationEscalation?.({
    clinicId,
    escalationId: escalation.id,
    recipientPhoneE164: escalation.secretaryPhoneE164,
    trigger,
  });
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
    text: "Seleccione explícitamente el Paciente antes de consultar o gestionar una Cita.",
  };
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
    /^registrar\s+menor\|([^|]+)\|([^|]+)\|(\d{4}-\d{2}-\d{2})$/i.exec(
      text.trim(),
    );
  if (match === null) return undefined;
  const [, rawName, rawGuardianDui, birthDate] = match;
  const name = rawName?.trim().replace(/\s+/g, " ");
  const guardianDui = rawGuardianDui?.trim();
  if (
    name === undefined ||
    name.length === 0 ||
    guardianDui === undefined ||
    !/^\d{8}-\d$/.test(guardianDui) ||
    birthDate === undefined ||
    !validLocalDate(birthDate)
  )
    return undefined;
  return { birthDate, guardianDui, name };
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

function isAdult(birthDate: string, now: Date) {
  const eighteenthBirthday = new Date(`${birthDate}T00:00:00.000Z`);
  eighteenthBirthday.setUTCFullYear(eighteenthBirthday.getUTCFullYear() + 18);
  return eighteenthBirthday <= now;
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
  guardianDui?: string;
  guardianshipVerificationStatus?: "pending";
  patientId: string;
  relationship?: "contact" | "tutor";
};

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
  const reservations: Array<{
    contactId: string;
    expiresAt: Date;
    id: string;
    offerId: string;
    patientId: string;
    startsAt: Date;
  }> = [];
  const appointments: Array<{
    authorContactId: string;
    id: string;
    origin: "reservation";
    patientId: string;
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
    trigger: ConversationEscalationTrigger;
  }> = [];
  const conversationEvents: Array<{
    contactId: string;
    type: "urgency-protocol";
  }> = [];
  const store: SimulatedWhatsAppBookingStore & {
    appointments: typeof appointments;
    conversationEscalations: typeof conversationEscalations;
    conversationEvents: typeof conversationEvents;
    messageOrigins: typeof messageOrigins;
    appointmentEvents: typeof appointmentEvents;
    escalations: typeof escalations;
    patients: InMemoryPatient[];
    reservations: typeof reservations;
  } = {
    appointments,
    conversationEscalations,
    conversationEvents,
    messageOrigins,
    appointmentEvents,
    escalations,
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
        duplicate,
      };
    },
    async completeMessage({ id, response }) {
      messages.set(id, response);
    },
    async createConversationEscalation({ contactId, trigger }) {
      conversationEscalations.push({ contactId, trigger });
      return {
        id: randomUUID(),
        secretaryPhoneE164:
          input.clinic.escalationNotificationsEnabled === true
            ? (input.clinic.escalationSecretaryPhoneE164 ?? null)
            : null,
      };
    },
    async isVoiceTranscriptionEnabled() {
      return input.clinic.voiceTranscriptionEnabled === true;
    },
    async recordUrgencyEvent({ contactId }) {
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
            .filter((patient) => patient.id === link.patientId)
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
    async registerAdult({ birthDate, contactId, dui, name }) {
      const patient = { birthDate, dui, id: randomUUID(), name };
      store.patients.push(patient);
      input.links.push({
        contactId,
        patientId: patient.id,
        relationship: "contact",
      });
      return patient;
    },
    async registerMinor({ birthDate, contactId, guardianDui, name }) {
      const patient = { birthDate, id: randomUUID(), name };
      store.patients.push(patient);
      input.links.push({
        contactId,
        guardianDui,
        guardianshipVerificationStatus: "pending",
        patientId: patient.id,
        relationship: "tutor",
      });
      return patient;
    },
    async holdReservation({ contactId, now, offerId, patientId, startsAt }) {
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
        startsAt,
      };
      reservations.push(reservation);
      return reservation;
    },
    async confirmReservation({ contactId, now, reservationId }) {
      const reservation = reservations.find(
        (candidate) =>
          candidate.id === reservationId &&
          candidate.contactId === contactId &&
          candidate.expiresAt > now,
      );
      if (reservation === undefined) return undefined;
      const appointment = {
        authorContactId: contactId,
        id: randomUUID(),
        origin: "reservation" as const,
        patientId: reservation.patientId,
        startsAt: reservation.startsAt,
        status: "confirmed" as const,
      };
      appointments.push(appointment);
      return appointment;
    },
    async cancelAppointment({ appointmentId, contactId, now, patientId }) {
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
