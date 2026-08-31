import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { CLINIC_UTC_OFFSET } from "~/clinic-timezone";
import {
  calculateCareOptionsFromInputs,
  type CareOptionInputs,
} from "~/server/application/care-options";
import type {
  BookingConversation,
  PublicOffer,
  SimulatedWhatsAppBookingStore,
} from "~/server/application/simulated-whatsapp-booking";
import type {
  AppointmentSelfManagementEscalationReader,
  AppointmentSelfManagementEscalationResolver,
  AppointmentSelfManagementStore,
} from "~/server/application/appointment-self-management";
import type {
  ConversationEscalationReader,
  ConversationEscalationResolver,
  EscalationNotificationSettingsStore,
} from "~/server/application/conversation-escalations";
import type { VoiceTranscriptionSettingsStore } from "~/server/application/voice-note-transcription-settings";
import {
  drizzleAgendaAppointmentCanceller,
  drizzleAgendaAppointmentRescheduler,
} from "~/server/db/agenda-appointment-rescheduler";
import { readAgendaCapacity } from "~/server/db/agenda-capacity-store";
import {
  inClinicTransaction,
  inSimulatedWhatsAppClinicTransaction,
  inSimulatedWhatsAppInboundTransaction,
} from "~/server/db/clinic-context";
import type { db } from "~/server/db";
import {
  appointmentEvents,
  appointmentSelfManagementEscalations,
  appointments,
  clinicUsers,
  clinics,
  conversationEscalations,
  conversationEvents,
  contactPatientLinks,
  contacts,
  doctors,
  patients,
  serviceOffers,
  services,
  simulatedWhatsAppMessages,
  temporaryReservations,
  whatsappConversations,
} from "~/server/db/schema";
import {
  lockWhatsAppOperationalPolicies,
  recordWhatsAppOperationalPolicyAudit,
} from "~/server/db/whatsapp-operational-policies-store";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const EMPTY_CONVERSATION: BookingConversation = {
  agendaStopped: false,
  escalationId: null,
  lastInboundOrigin: "text",
  misunderstandingCount: 0,
  reservationId: null,
  selectedOfferId: null,
  selectedPatientId: null,
};

/** Adaptador PostgreSQL del transporte simulado; conserva RLS e idempotencia. */
export const drizzleSimulatedWhatsAppBookingStore: SimulatedWhatsAppBookingStore =
  {
    async beginMessage(input) {
      return inSimulatedWhatsAppInboundTransaction(
        input.to,
        async (context, transaction) => {
          const contact = await transaction.query.contacts.findFirst({
            columns: { id: true },
            where: and(
              eq(contacts.clinicId, context.clinicId),
              eq(contacts.phoneE164, input.from),
            ),
          });
          if (contact === undefined) return undefined;
          const [created] = await transaction
            .insert(simulatedWhatsAppMessages)
            .values({
              clinicId: context.clinicId,
              contactId: contact.id,
              id: input.id,
              origin: input.origin,
            })
            .onConflictDoNothing()
            .returning({ id: simulatedWhatsAppMessages.id });
          if (created !== undefined) {
            return { ...context, contactId: contact.id, duplicate: null };
          }
          const existing =
            await transaction.query.simulatedWhatsAppMessages.findFirst({
              columns: { response: true },
              where: and(
                eq(simulatedWhatsAppMessages.clinicId, context.clinicId),
                eq(simulatedWhatsAppMessages.id, input.id),
              ),
            });
          if (existing?.response === null || existing?.response === undefined) {
            throw new Error("El mensaje simulado ya está siendo procesado");
          }
          return {
            ...context,
            contactId: contact.id,
            duplicate: hydrateStoredResponse(existing.response),
          };
        },
      );
    },

    async completeMessage(input) {
      await inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        (transaction) =>
          transaction
            .update(simulatedWhatsAppMessages)
            .set({ response: input.response })
            .where(
              and(
                eq(simulatedWhatsAppMessages.clinicId, input.clinicId),
                eq(simulatedWhatsAppMessages.id, input.id),
              ),
            ),
      );
    },

    async createConversationEscalation(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          const [escalation] = await transaction
            .insert(conversationEscalations)
            .values({
              clinicId: input.clinicId,
              contactId: input.contactId,
              createdAt: input.now,
              trigger: input.trigger,
            })
            .returning({ id: conversationEscalations.id });
          if (escalation === undefined) {
            throw new Error("No se pudo crear el Escalamiento de conversación");
          }
          const clinic = await transaction.query.clinics.findFirst({
            columns: {
              escalationNotificationsEnabled: true,
              escalationSecretaryPhoneE164: true,
            },
            where: eq(clinics.id, input.clinicId),
          });
          return {
            ...escalation,
            secretaryPhoneE164:
              clinic?.escalationNotificationsEnabled === true
                ? clinic.escalationSecretaryPhoneE164
                : null,
          };
        },
      );
    },

    async isVoiceTranscriptionEnabled(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) =>
          transaction.query.clinics
            .findFirst({
              columns: { voiceTranscriptionEnabled: true },
              where: eq(clinics.id, input.clinicId),
            })
            .then((clinic) => clinic?.voiceTranscriptionEnabled === true),
      );
    },

    async recordUrgencyEvent(input) {
      await inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        (transaction) =>
          transaction.insert(conversationEvents).values({
            clinicId: input.clinicId,
            contactId: input.contactId,
            occurredAt: input.now,
            type: "urgency-protocol",
          }),
      );
    },

    async getConversation(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          const conversation =
            await transaction.query.whatsappConversations.findFirst({
              columns: { state: true },
              where: and(
                eq(whatsappConversations.clinicId, input.clinicId),
                eq(whatsappConversations.contactId, input.contactId),
              ),
            });
          return { ...EMPTY_CONVERSATION, ...conversation?.state };
        },
      );
    },

    async saveConversation(input) {
      await inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        (transaction) =>
          transaction
            .insert(whatsappConversations)
            .values({
              clinicId: input.clinicId,
              contactId: input.contactId,
              state: input.conversation,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              set: { state: input.conversation, updatedAt: new Date() },
              target: [
                whatsappConversations.clinicId,
                whatsappConversations.contactId,
              ],
            }),
      );
    },

    async listLinkedPatients(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) =>
          transaction
            .select({
              birthDate: patients.birthDate,
              id: patients.id,
              name: patients.name,
            })
            .from(contactPatientLinks)
            .innerJoin(
              patients,
              and(
                eq(contactPatientLinks.clinicId, patients.clinicId),
                eq(contactPatientLinks.patientId, patients.id),
              ),
            )
            .where(
              and(
                eq(contactPatientLinks.clinicId, input.clinicId),
                eq(contactPatientLinks.contactId, input.contactId),
              ),
            )
            .then((rows) =>
              rows.flatMap((row) =>
                row.birthDate === null
                  ? []
                  : [{ ...row, birthDate: row.birthDate }],
              ),
            ),
      );
    },

    async listPublicOffers(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          const offers = await transaction
            .select({
              doctorId: doctors.id,
              doctorName: doctors.publicName,
              id: serviceOffers.id,
              priceUsd: serviceOffers.priceUsd,
              serviceName: services.name,
            })
            .from(serviceOffers)
            .innerJoin(
              doctors,
              and(
                eq(serviceOffers.clinicId, doctors.clinicId),
                eq(serviceOffers.doctorId, doctors.id),
              ),
            )
            .innerJoin(
              clinicUsers,
              and(
                eq(doctors.clinicId, clinicUsers.clinicId),
                eq(doctors.clinicUserId, clinicUsers.id),
              ),
            )
            .innerJoin(
              services,
              and(
                eq(serviceOffers.clinicId, services.clinicId),
                eq(serviceOffers.serviceId, services.id),
              ),
            )
            .where(
              and(
                eq(serviceOffers.clinicId, input.clinicId),
                eq(serviceOffers.active, true),
                eq(doctors.active, true),
                eq(clinicUsers.active, true),
              ),
            );
          return offers.map(
            (offer) =>
              ({
                ...offer,
                doctorName: offer.doctorName ?? "Médico sin nombre público",
                priceUsd: offer.priceUsd,
              }) satisfies PublicOffer,
          );
        },
      );
    },

    async registerAdult(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          const [patient] = await transaction
            .insert(patients)
            .values({
              birthDate: input.birthDate,
              clinicId: input.clinicId,
              dui: input.dui,
              name: input.name,
            })
            .returning({
              birthDate: patients.birthDate,
              id: patients.id,
              name: patients.name,
            });
          if (patient?.birthDate == null) {
            throw new Error("No se pudo registrar el Paciente adulto");
          }
          await transaction.insert(contactPatientLinks).values({
            clinicId: input.clinicId,
            contactId: input.contactId,
            patientId: patient.id,
            relationship: "contact",
          });
          return {
            birthDate: patient.birthDate,
            id: patient.id,
            name: patient.name,
          };
        },
      );
    },

    async registerMinor(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          const [patient] = await transaction
            .insert(patients)
            .values({
              birthDate: input.birthDate,
              clinicId: input.clinicId,
              name: input.name,
            })
            .returning({
              birthDate: patients.birthDate,
              id: patients.id,
              name: patients.name,
            });
          if (patient?.birthDate == null) {
            throw new Error("No se pudo registrar el Paciente menor");
          }
          await transaction.insert(contactPatientLinks).values({
            clinicId: input.clinicId,
            contactId: input.contactId,
            guardianDui: input.guardianDui,
            guardianshipVerificationStatus: "pending",
            patientId: patient.id,
            relationship: "tutor",
          });
          return {
            birthDate: patient.birthDate,
            id: patient.id,
            name: patient.name,
          };
        },
      );
    },

    async listCareOptions(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          if (!(await linkedPatientExists(transaction, input)))
            return undefined;
          const offer = await activeOffer(
            transaction,
            input.clinicId,
            input.offerId,
          );
          if (offer === undefined) return undefined;
          const options = await agendaOptions(transaction, {
            clinicId: input.clinicId,
            doctorId: offer.doctorId,
            now: input.now,
            offer,
            on: input.on,
          });
          return options.map((option) => option.startsAt);
        },
      );
    },

    async holdReservation(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          const offer = await activeOffer(
            transaction,
            input.clinicId,
            input.offerId,
          );
          if (
            offer === undefined ||
            !(await linkedPatientExists(transaction, input))
          )
            return undefined;
          await lockDoctor(transaction, offer.doctorId);
          const options = await agendaOptions(transaction, {
            clinicId: input.clinicId,
            doctorId: offer.doctorId,
            now: input.now,
            offer,
            on: localDate(input.startsAt),
          });
          if (
            !options.some(
              (option) =>
                option.startsAt.valueOf() === input.startsAt.valueOf(),
            )
          )
            return undefined;
          const endsAt = addMinutes(
            input.startsAt,
            offer.durationMinutes + offer.bufferMinutes,
          );
          const expiresAt = new Date(input.now.valueOf() + 10 * 60_000);
          const [reservation] = await transaction
            .insert(temporaryReservations)
            .values({
              clinicId: input.clinicId,
              contactId: input.contactId,
              doctorId: offer.doctorId,
              endsAt,
              expiresAt,
              patientId: input.patientId,
              serviceOfferId: input.offerId,
              startsAt: input.startsAt,
            })
            .returning({
              expiresAt: temporaryReservations.expiresAt,
              id: temporaryReservations.id,
            });
          return reservation;
        },
      );
    },

    async confirmReservation(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) => {
          const initialReservation =
            await transaction.query.temporaryReservations.findFirst({
              columns: {
                contactId: true,
                doctorId: true,
                expiresAt: true,
                id: true,
                patientId: true,
                serviceOfferId: true,
                startsAt: true,
              },
              where: and(
                eq(temporaryReservations.clinicId, input.clinicId),
                eq(temporaryReservations.id, input.reservationId),
                eq(temporaryReservations.contactId, input.contactId),
                gt(temporaryReservations.expiresAt, input.now),
              ),
            });
          if (initialReservation === undefined) return undefined;
          await lockDoctor(transaction, initialReservation.doctorId);
          const [reservation] = await transaction
            .delete(temporaryReservations)
            .where(
              and(
                eq(temporaryReservations.clinicId, input.clinicId),
                eq(temporaryReservations.id, input.reservationId),
                eq(temporaryReservations.contactId, input.contactId),
                gt(temporaryReservations.expiresAt, input.now),
              ),
            )
            .returning({
              doctorId: temporaryReservations.doctorId,
              patientId: temporaryReservations.patientId,
              serviceOfferId: temporaryReservations.serviceOfferId,
              startsAt: temporaryReservations.startsAt,
            });
          if (
            reservation?.patientId == null ||
            reservation.serviceOfferId == null
          )
            return undefined;
          const offer = await activeOffer(
            transaction,
            input.clinicId,
            reservation.serviceOfferId,
          );
          if (offer === undefined) return undefined;
          const endsAt = addMinutes(
            reservation.startsAt,
            offer.durationMinutes,
          );
          const occupiedUntil = addMinutes(endsAt, offer.bufferMinutes);
          const [appointment] = await transaction
            .insert(appointments)
            .values({
              authorContactId: input.contactId,
              bufferMinutes: offer.bufferMinutes,
              clinicId: input.clinicId,
              doctorId: reservation.doctorId,
              durationMinutes: offer.durationMinutes,
              endsAt,
              occupiedUntil,
              origin: "reservation",
              patientId: reservation.patientId,
              priceUsd: offer.priceUsd,
              serviceOfferId: reservation.serviceOfferId,
              startsAt: reservation.startsAt,
            })
            .returning({
              id: appointments.id,
              patientId: appointments.patientId,
            });
          if (appointment?.patientId == null) return undefined;
          await transaction.insert(appointmentEvents).values({
            actorContactId: input.contactId,
            appointmentId: appointment.id,
            clinicId: input.clinicId,
            type: "reservation-confirmed",
          });
          return {
            id: appointment.id,
            origin: "reservation" as const,
            patientId: appointment.patientId,
          };
        },
      );
    },

    async cancelAppointment(input) {
      const outcome =
        await drizzleAgendaAppointmentCanceller.cancelAppointment(input);
      if (outcome.kind !== "unauthorized") return outcome;
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        (transaction) =>
          escalateSelfManagementRequest(transaction, input, "cancel"),
      );
    },

    async rescheduleAppointment(input) {
      const outcome =
        await drizzleAgendaAppointmentRescheduler.rescheduleAppointment(input);
      if (outcome.kind !== "unauthorized") return outcome;
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        (transaction) =>
          escalateSelfManagementRequest(transaction, input, "reschedule"),
      );
    },
  };

/** Consulta de autorización para los futuros comandos de autogestión de Asclepio. */
export const drizzleAppointmentSelfManagementStore: AppointmentSelfManagementStore =
  {
    async isAppointmentAuthor(input) {
      return inSimulatedWhatsAppClinicTransaction(
        input.clinicId,
        async (transaction) =>
          (await transaction.query.appointments.findFirst({
            columns: { id: true },
            where: and(
              eq(appointments.clinicId, input.clinicId),
              eq(appointments.id, input.appointmentId),
              eq(appointments.authorContactId, input.contactId),
              eq(appointments.status, "confirmed"),
            ),
          })) !== undefined,
      );
    },
  };

/** Persistencia RLS de la bandeja humana de conversaciones de Panacea. */
export const drizzleConversationEscalationReader: ConversationEscalationReader =
  {
    async listConversationEscalations(input) {
      return inClinicTransaction(input, async (transaction) =>
        transaction
          .select({
            contactId: contacts.id,
            contactName: contacts.name,
            createdAt: conversationEscalations.createdAt,
            id: conversationEscalations.id,
            trigger: conversationEscalations.trigger,
          })
          .from(conversationEscalations)
          .innerJoin(
            contacts,
            and(
              eq(conversationEscalations.clinicId, contacts.clinicId),
              eq(conversationEscalations.contactId, contacts.id),
            ),
          )
          .where(
            and(
              eq(conversationEscalations.clinicId, input.clinicId),
              isNull(conversationEscalations.resolvedAt),
            ),
          )
          .orderBy(conversationEscalations.createdAt)
          .then((rows) =>
            rows.map(({ contactId, contactName, ...escalation }) => ({
              ...escalation,
              contact: { id: contactId, name: contactName },
            })),
          ),
      );
    },
  };

export const drizzleConversationEscalationResolver: ConversationEscalationResolver =
  {
    async resolveConversationEscalation(input) {
      return inClinicTransaction(input, async (transaction) => {
        const actorClinicUserId = await activeClinicUserId(transaction, input);
        if (actorClinicUserId === undefined) return false;
        const resolvedAt = new Date();
        const [escalation] = await transaction
          .update(conversationEscalations)
          .set({ resolvedAt, resolvedByClinicUserId: actorClinicUserId })
          .where(
            and(
              eq(conversationEscalations.clinicId, input.clinicId),
              eq(conversationEscalations.id, input.escalationId),
              isNull(conversationEscalations.resolvedAt),
            ),
          )
          .returning({ contactId: conversationEscalations.contactId });
        if (escalation === undefined) return false;
        const conversation =
          await transaction.query.whatsappConversations.findFirst({
            columns: { state: true },
            where: and(
              eq(whatsappConversations.clinicId, input.clinicId),
              eq(whatsappConversations.contactId, escalation.contactId),
            ),
          });
        if (conversation?.state.escalationId === input.escalationId) {
          await transaction
            .update(whatsappConversations)
            .set({
              state: {
                ...EMPTY_CONVERSATION,
                ...conversation.state,
                escalationId: null,
              },
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(whatsappConversations.clinicId, input.clinicId),
                eq(whatsappConversations.contactId, escalation.contactId),
              ),
            );
        }
        return true;
      });
    },
  };

/** Configuración RLS del aviso adicional por WhatsApp simulado a secretaria. */
export const drizzleEscalationNotificationSettingsStore: EscalationNotificationSettingsStore =
  {
    async getEscalationNotificationSettings(input) {
      return inClinicTransaction(input, async (transaction) => {
        if (!(await hasActiveClinicOwner(transaction, input))) return undefined;
        return transaction.query.clinics
          .findFirst({
            columns: {
              escalationNotificationsEnabled: true,
              escalationSecretaryPhoneE164: true,
            },
            where: eq(clinics.id, input.clinicId),
          })
          .then((clinic) =>
            clinic === undefined
              ? undefined
              : {
                  enabled: clinic.escalationNotificationsEnabled,
                  secretaryPhoneE164: clinic.escalationSecretaryPhoneE164,
                },
          );
      });
    },

    async setEscalationNotificationSettings(input) {
      return inClinicTransaction(input, async (transaction) => {
        if (!(await hasActiveClinicOwner(transaction, input))) return false;
        await lockWhatsAppOperationalPolicies(transaction, input.clinicId);
        const currentClinic = await transaction.query.clinics.findFirst({
          columns: {
            escalationNotificationsEnabled: true,
            escalationSecretaryPhoneE164: true,
            id: true,
          },
          where: eq(clinics.id, input.clinicId),
        });
        if (currentClinic === undefined) return false;
        if (
          currentClinic.escalationNotificationsEnabled === input.enabled &&
          currentClinic.escalationSecretaryPhoneE164 ===
            input.secretaryPhoneE164
        ) {
          return true;
        }
        const [clinic] = await transaction
          .update(clinics)
          .set({
            escalationNotificationsEnabled: input.enabled,
            escalationSecretaryPhoneE164: input.secretaryPhoneE164,
          })
          .where(
            and(
              eq(clinics.id, input.clinicId),
              eq(
                clinics.escalationNotificationsEnabled,
                currentClinic.escalationNotificationsEnabled,
              ),
              currentClinic.escalationSecretaryPhoneE164 === null
                ? isNull(clinics.escalationSecretaryPhoneE164)
                : eq(
                    clinics.escalationSecretaryPhoneE164,
                    currentClinic.escalationSecretaryPhoneE164,
                  ),
            ),
          )
          .returning({ id: clinics.id });
        if (clinic === undefined) return false;
        await recordWhatsAppOperationalPolicyAudit(transaction, {
          action: "whatsapp-escalation-notifications-updated",
          actorIdentityId: input.identityId,
          afterValues: {
            enabled: String(input.enabled),
            secretaryPhoneE164: input.secretaryPhoneE164,
          },
          beforeValues: {
            enabled: String(currentClinic.escalationNotificationsEnabled),
            secretaryPhoneE164: currentClinic.escalationSecretaryPhoneE164,
          },
          clinicId: input.clinicId,
        });
        return true;
      });
    },
  };

/** Configuración RLS de la Transcripción de nota de voz por Clínica. */
export const drizzleVoiceTranscriptionSettingsStore: VoiceTranscriptionSettingsStore =
  {
    async getVoiceTranscriptionSettings(input) {
      return inClinicTransaction(input, async (transaction) => {
        if (!(await hasActiveClinicOwner(transaction, input))) return undefined;
        return transaction.query.clinics
          .findFirst({
            columns: { voiceTranscriptionEnabled: true },
            where: eq(clinics.id, input.clinicId),
          })
          .then((clinic) => clinic?.voiceTranscriptionEnabled);
      });
    },

    async setVoiceTranscriptionSettings(input) {
      return inClinicTransaction(input, async (transaction) => {
        if (!(await hasActiveClinicOwner(transaction, input))) return false;
        await lockWhatsAppOperationalPolicies(transaction, input.clinicId);
        const currentClinic = await transaction.query.clinics.findFirst({
          columns: { id: true, voiceTranscriptionEnabled: true },
          where: eq(clinics.id, input.clinicId),
        });
        if (currentClinic === undefined) return false;
        if (currentClinic.voiceTranscriptionEnabled === input.enabled)
          return true;
        const [clinic] = await transaction
          .update(clinics)
          .set({ voiceTranscriptionEnabled: input.enabled })
          .where(
            and(
              eq(clinics.id, input.clinicId),
              eq(
                clinics.voiceTranscriptionEnabled,
                currentClinic.voiceTranscriptionEnabled,
              ),
            ),
          )
          .returning({ id: clinics.id });
        if (clinic === undefined) return false;
        await recordWhatsAppOperationalPolicyAudit(transaction, {
          action: "whatsapp-voice-transcription-updated",
          actorIdentityId: input.identityId,
          afterValues: { enabled: String(input.enabled) },
          beforeValues: {
            enabled: String(currentClinic.voiceTranscriptionEnabled),
          },
          clinicId: input.clinicId,
        });
        return true;
      });
    },
  };

async function hasActiveClinicOwner(
  transaction: ClinicTransaction,
  input: { clinicId: string; identityId: string },
) {
  return (
    (await transaction.query.clinicUsers.findFirst({
      columns: { id: true },
      where: and(
        eq(clinicUsers.clinicId, input.clinicId),
        eq(clinicUsers.identityId, input.identityId),
        eq(clinicUsers.role, "owner"),
        eq(clinicUsers.active, true),
      ),
    })) !== undefined
  );
}

async function activeClinicUserId(
  transaction: ClinicTransaction,
  input: { clinicId: string; identityId: string },
) {
  const member = await transaction.query.clinicUsers.findFirst({
    columns: { id: true },
    where: and(
      eq(clinicUsers.clinicId, input.clinicId),
      eq(clinicUsers.identityId, input.identityId),
      eq(clinicUsers.active, true),
    ),
  });
  return member?.id;
}

export const drizzleAppointmentSelfManagementEscalationReader: AppointmentSelfManagementEscalationReader =
  {
    async listSelfManagementEscalations(input) {
      return inClinicTransaction(input, async (transaction) =>
        transaction
          .select({
            action: appointmentSelfManagementEscalations.action,
            appointmentId: appointmentSelfManagementEscalations.appointmentId,
            contactId: contacts.id,
            contactName: contacts.name,
            createdAt: appointmentSelfManagementEscalations.createdAt,
            id: appointmentSelfManagementEscalations.id,
            requestedStartsAt:
              appointmentSelfManagementEscalations.requestedStartsAt,
          })
          .from(appointmentSelfManagementEscalations)
          .innerJoin(
            contacts,
            and(
              eq(
                appointmentSelfManagementEscalations.clinicId,
                contacts.clinicId,
              ),
              eq(appointmentSelfManagementEscalations.contactId, contacts.id),
            ),
          )
          .where(
            and(
              eq(appointmentSelfManagementEscalations.clinicId, input.clinicId),
              isNull(appointmentSelfManagementEscalations.resolvedAt),
            ),
          )
          .orderBy(appointmentSelfManagementEscalations.createdAt)
          .then((rows) =>
            rows.map(({ contactId, contactName, ...escalation }) => ({
              ...escalation,
              contact: { id: contactId, name: contactName },
            })),
          ),
      );
    },
  };

export const drizzleAppointmentSelfManagementEscalationResolver: AppointmentSelfManagementEscalationResolver =
  {
    async resolveSelfManagementEscalation(input) {
      return inClinicTransaction(input, async (transaction) => {
        const actorClinicUserId = await activeClinicUserId(transaction, input);
        if (actorClinicUserId === undefined) return false;
        const resolvedAt = new Date();
        const [escalation] = await transaction
          .update(appointmentSelfManagementEscalations)
          .set({ resolvedAt, resolvedByClinicUserId: actorClinicUserId })
          .where(
            and(
              eq(appointmentSelfManagementEscalations.clinicId, input.clinicId),
              eq(appointmentSelfManagementEscalations.id, input.escalationId),
              isNull(appointmentSelfManagementEscalations.resolvedAt),
            ),
          )
          .returning({
            appointmentId: appointmentSelfManagementEscalations.appointmentId,
            contactId: appointmentSelfManagementEscalations.contactId,
          });
        if (escalation === undefined) return false;
        await transaction.insert(appointmentEvents).values({
          actorClinicUserId,
          appointmentId: escalation.appointmentId,
          clinicId: input.clinicId,
          occurredAt: resolvedAt,
          reason: "self-management-resolved",
          type: "self-management-resolved",
        });
        const conversation =
          await transaction.query.whatsappConversations.findFirst({
            columns: { state: true },
            where: and(
              eq(whatsappConversations.clinicId, input.clinicId),
              eq(whatsappConversations.contactId, escalation.contactId),
            ),
          });
        if (conversation?.state.escalationId === input.escalationId) {
          await transaction
            .update(whatsappConversations)
            .set({
              state: {
                ...EMPTY_CONVERSATION,
                ...conversation.state,
                escalationId: null,
              },
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(whatsappConversations.clinicId, input.clinicId),
                eq(whatsappConversations.contactId, escalation.contactId),
              ),
            );
        }
        return true;
      });
    },
  };

async function escalateSelfManagementRequest(
  transaction: ClinicTransaction,
  input: {
    appointmentId: string;
    clinicId: string;
    contactId: string;
    startsAt?: Date;
  },
  action: "cancel" | "reschedule",
) {
  const [escalation] = await transaction
    .insert(appointmentSelfManagementEscalations)
    .values({
      action,
      appointmentId: input.appointmentId,
      clinicId: input.clinicId,
      contactId: input.contactId,
      requestedStartsAt: input.startsAt,
    })
    .returning({ id: appointmentSelfManagementEscalations.id });
  if (escalation === undefined) {
    throw new Error("No se pudo crear el Escalamiento de la Cita");
  }
  await transaction.insert(appointmentEvents).values({
    actorContactId: input.contactId,
    appointmentId: input.appointmentId,
    clinicId: input.clinicId,
    reason: action,
    type: "self-management-escalated",
  });
  return { id: escalation.id, kind: "escalated" as const };
}

async function activeOffer(
  transaction: ClinicTransaction,
  clinicId: string,
  offerId: string,
) {
  const [offer] = await transaction
    .select({
      bufferMinutes: serviceOffers.bufferMinutes,
      doctorId: serviceOffers.doctorId,
      durationMinutes: serviceOffers.durationMinutes,
      priceUsd: serviceOffers.priceUsd,
    })
    .from(serviceOffers)
    .innerJoin(
      doctors,
      and(
        eq(serviceOffers.clinicId, doctors.clinicId),
        eq(serviceOffers.doctorId, doctors.id),
      ),
    )
    .innerJoin(
      clinicUsers,
      and(
        eq(doctors.clinicId, clinicUsers.clinicId),
        eq(doctors.clinicUserId, clinicUsers.id),
      ),
    )
    .where(
      and(
        eq(serviceOffers.clinicId, clinicId),
        eq(serviceOffers.id, offerId),
        eq(serviceOffers.active, true),
        eq(doctors.active, true),
        eq(clinicUsers.active, true),
      ),
    );
  return offer;
}

async function linkedPatientExists(
  transaction: ClinicTransaction,
  input: { clinicId: string; contactId: string; patientId: string },
) {
  return (
    (await transaction.query.contactPatientLinks.findFirst({
      columns: { id: true },
      where: and(
        eq(contactPatientLinks.clinicId, input.clinicId),
        eq(contactPatientLinks.contactId, input.contactId),
        eq(contactPatientLinks.patientId, input.patientId),
      ),
    })) !== undefined
  );
}

async function agendaOptions(
  transaction: ClinicTransaction,
  input: {
    clinicId: string;
    doctorId: string;
    now: Date;
    offer: { bufferMinutes: number; durationMinutes: number };
    on: string;
  },
) {
  const startsAt = new Date(`${input.on}T00:00:00${CLINIC_UTC_OFFSET}`);
  const endsAt = new Date(startsAt.valueOf() + 24 * 60 * 60_000);
  const capacity: CareOptionInputs = {
    ...(await readAgendaCapacity(
      transaction,
      { clinicId: input.clinicId, doctorId: input.doctorId, endsAt, startsAt },
      input.now,
    )),
    offer: input.offer,
  };
  return calculateCareOptionsFromInputs(
    { from: input.on, to: input.on },
    capacity,
    input.now,
  );
}

function localDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/El_Salvador",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.valueOf() + minutes * 60_000);
}

function lockDoctor(transaction: ClinicTransaction, doctorId: string) {
  return transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext(${doctorId}))`,
  );
}

function hydrateStoredResponse(
  response: NonNullable<typeof simulatedWhatsAppMessages.$inferSelect.response>,
) {
  if (response.kind === "care-options") {
    return {
      ...response,
      options: response.options.map((option) => new Date(option)),
    };
  }
  if (response.kind === "reservation-held") {
    return { ...response, expiresAt: new Date(response.expiresAt) };
  }
  if (response.kind === "appointment-rescheduled") {
    return { ...response, startsAt: new Date(response.startsAt) };
  }
  return response;
}
