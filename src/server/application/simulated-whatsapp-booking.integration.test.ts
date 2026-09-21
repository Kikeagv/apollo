import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  buildWhatsAppConsentPolicy,
  WHATSAPP_ADULT_PATIENT_CONSENT_DECLARATION,
  WHATSAPP_TUTOR_PATIENT_CONSENT_DECLARATION,
} from "~/domain/whatsapp-consent";
import { createSimulatedWhatsAppConnection } from "~/domain/whatsapp-connection";
import type { WhatsAppInboundMessage } from "~/domain/whatsapp-inbound";
import { createWhatsAppConsentGate } from "./whatsapp-consent";
import {
  runKapsoInboundWorker,
  type WhatsAppInboundAssistant,
} from "./whatsapp-inbound";
import {
  activateWhatsAppHumanTakeover,
  isWhatsAppHumanTakeoverActive,
  processWhatsAppTextForContact,
  processSimulatedWhatsAppMessage,
} from "./simulated-whatsapp-booking";
import { listPendingGuardianshipVerifications } from "./administrative-records";
import { sendAppointmentReminder } from "./appointment-reminders";
import { canContactManageAppointment } from "./appointment-self-management";
import { resolveAppointmentSelfManagementEscalation } from "./appointment-self-management";
import { listPendingCases, resolvePendingCase } from "./pending";
import {
  listConversationEscalations,
  resolveConversationEscalation,
  resolveConversationEscalationWithAudit,
} from "./conversation-escalations";
import {
  listWhatsAppInboundOperationalAlerts,
  resolveWhatsAppInboundOperationalAlert,
} from "../db/whatsapp-inbound-alert-store";
import { db } from "../db";
import {
  inClinicTransaction,
  inAppointmentSchedulerTransaction,
  inSimulatedWhatsAppClinicTransaction,
  inSuperadminTransaction,
  inWhatsAppInboundWorkerTransaction,
} from "../db/clinic-context";
import {
  drizzleAppointmentSelfManagementStore,
  drizzleAppointmentSelfManagementEscalationResolver,
  drizzleConversationEscalationReader,
  drizzleConversationEscalationResolver,
  drizzleSimulatedWhatsAppBookingStore,
} from "../db/simulated-whatsapp-booking-store";
import {
  drizzlePendingResolver,
  drizzlePendingStore,
} from "../db/pending-store";
import { drizzleAdministrativeRecordsStore } from "../db/administrative-records-store";
import { drizzleManualAppointmentStore } from "../db/manual-appointment-store";
import {
  drizzleTransactionalDeliveryStore,
  reactivatePendingWhatsAppDeliveries,
} from "../db/transactional-delivery-store";
import { drizzleWhatsAppInboundStore } from "../db/whatsapp-inbound-store";
import {
  getSentSimulatedAppointmentReminders,
  simulatedAppointmentReminderSender,
} from "../whatsapp/simulated-appointment-messages";
import {
  appointmentEvents,
  appointments,
  appointmentSelfManagementEscalations,
  apoloSuperadmins,
  clinicTermsContract,
  clinicUsers,
  clinics,
  conversationEscalations,
  conversationEvents,
  contactPatientLinks,
  contacts,
  doctors,
  effectiveSchedulePeriods,
  effectiveSchedules,
  patients,
  serviceOffers,
  services,
  simulatedWhatsAppMessages,
  transactionalDeliveryAlerts,
  transactionalDeliveryAttempts,
  transactionalDeliveries,
  user as identities,
  whatsappContactConsents,
  whatsappConnections,
  whatsappConversations,
  whatsappIdentities,
  whatsappInboundMessages,
  whatsappInboundAlerts,
  whatsappInboundReplies,
} from "../db/schema";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("Reserva simulada de WhatsApp persistente", () => {
  databaseTest(
    "agrega los tres tipos de Pendiente bajo RLS, conserva el historial y sus evidencias",
    async () => {
      const fixture = await createFixture();
      try {
        const appointmentId = await inClinicTransaction(
          fixture,
          async (transaction) => {
            const doctor = await transaction.query.doctors.findFirst({
              columns: { id: true },
              where: eq(doctors.clinicId, fixture.clinicId),
            });
            if (doctor === undefined) throw new Error("Falta el Médico");
            const startsAt = new Date("2026-09-07T14:00:00.000Z");
            const endsAt = new Date("2026-09-07T14:30:00.000Z");
            const [appointment] = await transaction
              .insert(appointments)
              .values({
                bufferMinutes: 0,
                clinicId: fixture.clinicId,
                doctorId: doctor.id,
                durationMinutes: 30,
                endsAt,
                occupiedUntil: endsAt,
                origin: "manual",
                patientId: fixture.patientId,
                serviceOfferId: fixture.offerId,
                startsAt,
              })
              .returning({ id: appointments.id });
            if (appointment === undefined) {
              throw new Error("No se creó la Cita de prueba");
            }
            await transaction.insert(appointmentEvents).values({
              actorContactId: fixture.contactId,
              appointmentId: appointment.id,
              clinicId: fixture.clinicId,
              reason: "reschedule",
              type: "self-management-escalated",
            });
            return appointment.id;
          },
        );

        const conversationEscalationId =
          await inSimulatedWhatsAppClinicTransaction(
            fixture.clinicId,
            async (transaction) => {
              const [escalation] = await transaction
                .insert(conversationEscalations)
                .values({
                  clinicId: fixture.clinicId,
                  contactId: fixture.contactId,
                  createdAt: new Date("2026-08-10T12:00:00.000Z"),
                  priority: "urgent",
                  trigger: "human-request",
                })
                .returning({ id: conversationEscalations.id });
              if (escalation === undefined) {
                throw new Error("No se creó el Escalamiento de conversación");
              }
              await transaction.insert(conversationEvents).values({
                clinicId: fixture.clinicId,
                contactId: fixture.contactId,
                type: "urgency-protocol",
              });
              return escalation.id;
            },
          );
        const appointmentEscalationId =
          await inSimulatedWhatsAppClinicTransaction(
            fixture.clinicId,
            async (transaction) => {
              const [escalation] = await transaction
                .insert(appointmentSelfManagementEscalations)
                .values({
                  action: "reschedule",
                  appointmentId,
                  clinicId: fixture.clinicId,
                  contactId: fixture.contactId,
                  createdAt: new Date("2026-08-11T12:00:00.000Z"),
                  priority: "high",
                  requestedStartsAt: new Date("2026-09-08T14:00:00.000Z"),
                })
                .returning({ id: appointmentSelfManagementEscalations.id });
              if (escalation === undefined) {
                throw new Error("No se creó el Escalamiento de Cita");
              }
              return escalation.id;
            },
          );
        const deliveryAlertId = await inAppointmentSchedulerTransaction(
          async (transaction) => {
            const createdAt = new Date("2026-08-12T12:00:00.000Z");
            const retainUntil = new Date("2027-08-12T12:00:00.000Z");
            const [delivery] = await transaction
              .insert(transactionalDeliveries)
              .values({
                attempts: 3,
                clinicId: fixture.clinicId,
                createdAt,
                idempotencyKey: `pending-${randomUUID()}`,
                kind: "daily-agenda-pdf",
                lastError: "Proveedor no disponible",
                nextAttemptAt: createdAt,
                payload: {},
                retainUntil,
                status: "failed",
                updatedAt: createdAt,
              })
              .returning({ id: transactionalDeliveries.id });
            if (delivery === undefined) {
              throw new Error("No se creó la Entrega de prueba");
            }
            await transaction.insert(transactionalDeliveryAttempts).values({
              attempt: 3,
              clinicId: fixture.clinicId,
              deliveryId: delivery.id,
              error: "Proveedor no disponible",
              occurredAt: createdAt,
              outcome: "failed",
              retainUntil,
            });
            const [alert] = await transaction
              .insert(transactionalDeliveryAlerts)
              .values({
                clinicId: fixture.clinicId,
                createdAt,
                deliveryId: delivery.id,
                priority: "normal",
                retainUntil,
              })
              .returning({ id: transactionalDeliveryAlerts.id });
            if (alert === undefined) {
              throw new Error("No se creó la Alerta de Entrega");
            }
            return alert.id;
          },
        );

        const open = await listPendingCases(
          {
            category: "all",
            clinicId: fixture.clinicId,
            identityId: fixture.identityId,
            status: "open",
          },
          drizzlePendingStore,
        );
        expect(open.items.map((pending) => pending.category)).toEqual([
          "conversation",
          "appointment",
          "delivery",
        ]);
        expect(open.counts).toEqual({
          appointment: 1,
          conversation: 1,
          delivery: 1,
        });

        await expect(
          listPendingCases(
            {
              category: "appointment",
              clinicId: fixture.clinicId,
              identityId: fixture.identityId,
              status: "open",
            },
            drizzlePendingStore,
          ),
        ).resolves.toMatchObject({
          counts: { appointment: 1, conversation: 1, delivery: 1 },
          items: [{ id: appointmentEscalationId }],
          total: 3,
        });

        await resolvePendingCase(
          {
            category: "conversation",
            clinicId: fixture.clinicId,
            id: conversationEscalationId,
            identityId: fixture.identityId,
          },
          drizzlePendingResolver,
        );
        await resolvePendingCase(
          {
            category: "appointment",
            clinicId: fixture.clinicId,
            id: appointmentEscalationId,
            identityId: fixture.identityId,
          },
          drizzlePendingResolver,
        );
        await resolvePendingCase(
          {
            category: "delivery",
            clinicId: fixture.clinicId,
            id: deliveryAlertId,
            identityId: fixture.identityId,
            resolutionEvidence: "Se verificó el rechazo del proveedor.",
          },
          drizzlePendingResolver,
        );

        await expect(
          listPendingCases(
            {
              category: "all",
              clinicId: fixture.clinicId,
              identityId: fixture.identityId,
              status: "open",
            },
            drizzlePendingStore,
          ),
        ).resolves.toMatchObject({ total: 0 });
        const resolved = await listPendingCases(
          {
            category: "all",
            clinicId: fixture.clinicId,
            identityId: fixture.identityId,
            status: "resolved",
          },
          drizzlePendingStore,
        );
        expect(resolved).toMatchObject({
          counts: { appointment: 1, conversation: 1, delivery: 1 },
          total: 3,
        });
        expect(
          resolved.items.find((item) => item.id === conversationEscalationId),
        ).toMatchObject({
          resolvedBy: { name: fixture.identityId },
        });

        const preserved = await inClinicTransaction(
          fixture,
          async (transaction) => {
            const owner = await transaction.query.clinicUsers.findFirst({
              columns: { id: true },
              where: and(
                eq(clinicUsers.clinicId, fixture.clinicId),
                eq(clinicUsers.identityId, fixture.identityId),
              ),
            });
            if (owner === undefined) throw new Error("Falta el propietario");
            const conversation =
              await transaction.query.conversationEscalations.findFirst({
                where: eq(conversationEscalations.id, conversationEscalationId),
              });
            const appointment =
              await transaction.query.appointmentSelfManagementEscalations.findFirst(
                {
                  where: eq(
                    appointmentSelfManagementEscalations.id,
                    appointmentEscalationId,
                  ),
                },
              );
            const delivery =
              await transaction.query.transactionalDeliveryAlerts.findFirst({
                where: eq(transactionalDeliveryAlerts.id, deliveryAlertId),
              });
            const attempts =
              delivery === undefined
                ? []
                : await transaction
                    .select({ id: transactionalDeliveryAttempts.id })
                    .from(transactionalDeliveryAttempts)
                    .where(
                      eq(
                        transactionalDeliveryAttempts.deliveryId,
                        delivery.deliveryId,
                      ),
                    );
            const conversationHistory = await transaction
              .select({ type: conversationEvents.type })
              .from(conversationEvents)
              .where(eq(conversationEvents.contactId, fixture.contactId));
            const appointmentHistory = await transaction
              .select({
                actorClinicUserId: appointmentEvents.actorClinicUserId,
                type: appointmentEvents.type,
              })
              .from(appointmentEvents)
              .where(eq(appointmentEvents.appointmentId, appointmentId));
            return {
              appointment,
              appointmentHistory,
              attempts,
              conversation,
              conversationHistory,
              delivery,
              owner,
            };
          },
        );
        expect(preserved.conversation?.resolvedAt).not.toBeNull();
        expect(preserved.conversation?.resolvedByClinicUserId).toBe(
          preserved.owner.id,
        );
        expect(preserved.appointment?.resolvedAt).not.toBeNull();
        expect(preserved.appointment?.resolvedByClinicUserId).toBe(
          preserved.owner.id,
        );
        expect(preserved.delivery?.resolvedAt).not.toBeNull();
        expect(preserved.delivery?.resolvedByClinicUserId).toBe(
          preserved.owner.id,
        );
        expect(preserved.delivery?.resolutionEvidence).toBe(
          "Se verificó el rechazo del proveedor.",
        );
        expect(preserved.attempts).toHaveLength(1);
        expect(preserved.conversationHistory).toContainEqual({
          type: "urgency-protocol",
        });
        expect(preserved.appointmentHistory).toContainEqual({
          actorClinicUserId: preserved.owner.id,
          type: "self-management-resolved",
        });

        await expect(
          listPendingCases(
            {
              category: "all",
              clinicId: fixture.other.clinicId,
              identityId: fixture.identityId,
              status: "open",
            },
            drizzlePendingStore,
          ),
        ).rejects.toThrow("La Identidad no pertenece a la Clínica");
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "bloquea al Tutor pendiente aunque el canal esté aceptado y RLS rechaza su consentimiento por Paciente",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-08-14T12:00:00.000Z");
      try {
        const tutor = await inClinicTransaction(
          fixture,
          async (transaction) => {
            const [createdTutor] = await transaction
              .insert(contacts)
              .values({
                clinicId: fixture.clinicId,
                name: "Carlos Tutor pendiente",
                phoneE164: "+50370000003",
              })
              .returning({ id: contacts.id });
            const doctor = await transaction.query.doctors.findFirst({
              columns: { id: true },
              where: eq(doctors.clinicId, fixture.clinicId),
            });
            if (createdTutor === undefined || doctor === undefined) {
              throw new Error("Falta el Tutor o el Médico de prueba");
            }
            await transaction.insert(contactPatientLinks).values({
              clinicId: fixture.clinicId,
              contactId: createdTutor.id,
              guardianDeclaration: "DECLARO REPRESENTACIÓN AUTORIZADA",
              guardianDui: "01234567-8",
              guardianshipVerificationStatus: "pending",
              patientId: fixture.patientId,
              relationship: "tutor",
            });
            const startsAt = new Date("2026-08-20T14:00:00.000Z");
            const endsAt = new Date("2026-08-20T14:30:00.000Z");
            const [appointment] = await transaction
              .insert(appointments)
              .values({
                bufferMinutes: 0,
                clinicId: fixture.clinicId,
                doctorId: doctor.id,
                durationMinutes: 30,
                endsAt,
                occupiedUntil: endsAt,
                origin: "manual",
                patientId: fixture.patientId,
                serviceOfferId: fixture.offerId,
                startsAt,
              })
              .returning({ id: appointments.id });
            if (appointment === undefined) {
              throw new Error("No se creó la Cita del Tutor pendiente");
            }
            return {
              appointmentId: appointment.id,
              contactId: createdTutor.id,
            };
          },
        );
        const identity = await inWhatsAppInboundWorkerTransaction(
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            const [createdIdentity] = await transaction
              .insert(whatsappIdentities)
              .values({
                clinicId: fixture.clinicId,
                contactId: tutor.contactId,
                phoneE164: "+50370000003",
                phoneNumberId: `simulated-${fixture.clinicId}`,
                status: "active",
              })
              .returning({ id: whatsappIdentities.id });
            const termsContract =
              await transaction.query.clinicTermsContract.findFirst({
                columns: { currentVersion: true },
                where: eq(clinicTermsContract.id, true),
              });
            if (createdIdentity === undefined || termsContract === undefined) {
              throw new Error("Falta la Identidad o los Términos de prueba");
            }
            const policy = buildWhatsAppConsentPolicy(
              termsContract.currentVersion,
            );
            await transaction.insert(whatsappContactConsents).values({
              acceptedAt: now,
              acceptedRole: "contact",
              clinicId: fixture.clinicId,
              contactId: tutor.contactId,
              declaration: "CONTINUAR",
              identityId: createdIdentity.id,
              interactionId: `pending-tutor-channel-${fixture.clinicId}`,
              patientId: null,
              phoneE164: "+50370000003",
              privacyVersion: policy.privacyVersion,
              provider: "kapso",
              scope: "channel",
              status: "accepted",
              termsVersion: policy.termsVersion,
              textReference: policy.immutableTextReference,
            });
            return createdIdentity;
          },
        );

        await expect(
          drizzleSimulatedWhatsAppBookingStore.findWhatsAppPatientConsentEligibility(
            {
              clinicId: fixture.clinicId,
              contactId: tutor.contactId,
              now,
              patientId: fixture.patientId,
            },
          ),
        ).resolves.toBe("tutor-pending");
        await expect(
          processWhatsAppTextForContact(
            {
              clinicId: fixture.clinicId,
              contactId: tutor.contactId,
              identityId: identity.id,
              messageId: `pending-tutor-operation-${fixture.clinicId}`,
              text: `paciente ${fixture.patientId}`,
            },
            drizzleSimulatedWhatsAppBookingStore,
            now,
          ),
        ).resolves.toMatchObject({
          kind: "patient-selection-required",
          patients: [],
        });
        await expect(
          drizzleManualAppointmentStore.hasCurrentWhatsAppConsent({
            appointmentId: tutor.appointmentId,
            clinicId: fixture.clinicId,
            contactId: tutor.contactId,
            identityId: fixture.identityId,
            now,
          }),
        ).resolves.toBe(false);

        const [pendingDelivery] = await inAppointmentSchedulerTransaction(
          (transaction) =>
            transaction
              .insert(transactionalDeliveries)
              .values({
                appointmentId: tutor.appointmentId,
                clinicId: fixture.clinicId,
                idempotencyKey: `pending-tutor-delivery-${fixture.clinicId}`,
                kind: "appointment-reminder",
                nextAttemptAt: new Date(now.valueOf() - 60_000),
                payload: {
                  appointmentId: tutor.appointmentId,
                  checkpoint: "24h",
                  recipient: {
                    id: tutor.contactId,
                    name: "Carlos Tutor pendiente",
                    phoneE164: "+50370000003",
                  },
                },
                recipientContactId: tutor.contactId,
                retainUntil: new Date(now.valueOf() + 365 * 24 * 60 * 60_000),
                status: "pending",
              })
              .returning({ id: transactionalDeliveries.id }),
        );
        if (pendingDelivery === undefined) {
          throw new Error("No se creó la Entrega pendiente del Tutor");
        }
        const claimed =
          await drizzleTransactionalDeliveryStore.claimReadyDeliveries({ now });
        expect(
          claimed.some((delivery) => delivery.id === pendingDelivery.id),
        ).toBe(false);
        const deliveryState = await inClinicTransaction(
          fixture,
          async (transaction) => {
            const [delivery] = await transaction
              .select({
                lastError: transactionalDeliveries.lastError,
                status: transactionalDeliveries.status,
              })
              .from(transactionalDeliveries)
              .where(eq(transactionalDeliveries.id, pendingDelivery.id));
            return delivery;
          },
        );
        expect(deliveryState).toEqual({
          lastError: "Consentimiento de WhatsApp no vigente",
          status: "suppressed",
        });

        await expect(
          inWhatsAppInboundWorkerTransaction(async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            const termsContract =
              await transaction.query.clinicTermsContract.findFirst({
                columns: { currentVersion: true },
                where: eq(clinicTermsContract.id, true),
              });
            if (termsContract === undefined) {
              throw new Error("Faltan los Términos de prueba");
            }
            const policy = buildWhatsAppConsentPolicy(
              termsContract.currentVersion,
            );
            return transaction.insert(whatsappContactConsents).values({
              acceptedAt: now,
              acceptedRole: "tutor",
              clinicId: fixture.clinicId,
              contactId: tutor.contactId,
              declaration: WHATSAPP_TUTOR_PATIENT_CONSENT_DECLARATION,
              identityId: identity.id,
              interactionId: `pending-tutor-patient-${fixture.clinicId}`,
              patientId: fixture.patientId,
              phoneE164: "+50370000003",
              privacyVersion: policy.privacyVersion,
              provider: "kapso",
              scope: "patient",
              status: "accepted",
              termsVersion: policy.termsVersion,
              textReference: policy.immutableTextReference,
            });
          }),
        ).rejects.toThrow(/row-level security policy/);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "resuelve Clínica y Contacto por E.164, confirma una Reserva y aísla sus datos por RLS",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-08-12T14:00:00.000Z");
      try {
        await processSimulatedWhatsAppMessage(
          message(fixture, "message-1", "paciente patient-placeholder"),
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        const selected = await processSimulatedWhatsAppMessage(
          message(fixture, "message-2", `paciente ${fixture.patientId}`),
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        expect(selected).toMatchObject({ kind: "patient-selected" });
        await processSimulatedWhatsAppMessage(
          message(
            fixture,
            "message-3",
            `opciones ${fixture.offerId} 2026-08-17`,
          ),
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        const held = await processSimulatedWhatsAppMessage(
          message(fixture, "message-4", "reservar 2026-08-17T14:00:00.000Z"),
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        expect(held).toMatchObject({ kind: "reservation-held" });
        const confirmed = await processSimulatedWhatsAppMessage(
          message(fixture, "message-5", "confirmar"),
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        if (confirmed?.kind !== "appointment-confirmed") {
          throw new Error("No se confirmó la Cita de reserva");
        }
        const tutor = await inClinicTransaction(
          fixture,
          async (transaction) => {
            const [createdTutor] = await transaction
              .insert(contacts)
              .values({
                clinicId: fixture.clinicId,
                name: "Carlos Tutor",
                phoneE164: "+50370000003",
              })
              .returning({ id: contacts.id });
            if (createdTutor === undefined)
              throw new Error("No se creó el Tutor");
            await transaction.insert(contactPatientLinks).values({
              clinicId: fixture.clinicId,
              contactId: createdTutor.id,
              guardianDeclaration: "DECLARO REPRESENTACIÓN AUTORIZADA",
              guardianDui: "01234567-8",
              guardianshipVerificationStatus: "verified",
              patientId: fixture.patientId,
              relationship: "tutor",
            });
            return createdTutor;
          },
        );
        await inWhatsAppInboundWorkerTransaction(async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
          );
          const termsContract =
            await transaction.query.clinicTermsContract.findFirst({
              columns: { currentVersion: true },
              where: eq(clinicTermsContract.id, true),
            });
          if (termsContract === undefined) {
            throw new Error("Falta el Contrato de términos de prueba");
          }
          const policy = buildWhatsAppConsentPolicy(
            termsContract.currentVersion,
          );
          const [whatsappIdentity] = await transaction
            .insert(whatsappIdentities)
            .values({
              clinicId: fixture.clinicId,
              contactId: tutor.id,
              phoneE164: "+50370000003",
              phoneNumberId: `simulated-${fixture.clinicId}`,
              status: "active",
            })
            .returning({ id: whatsappIdentities.id });
          if (whatsappIdentity === undefined) {
            throw new Error("Falta la Identidad de WhatsApp del Tutor");
          }
          await transaction.insert(whatsappContactConsents).values({
            acceptedAt: new Date("2026-08-12T12:00:00.000Z"),
            acceptedRole: "contact",
            clinicId: fixture.clinicId,
            contactId: tutor.id,
            declaration: "CONTINUAR",
            identityId: whatsappIdentity.id,
            interactionId: `fixture-tutor-consent-${fixture.clinicId}`,
            patientId: null,
            phoneE164: "+50370000003",
            privacyVersion: policy.privacyVersion,
            provider: "kapso",
            scope: "channel",
            termsVersion: policy.termsVersion,
            textReference: policy.immutableTextReference,
          });
          await transaction.insert(whatsappContactConsents).values({
            acceptedAt: new Date("2026-08-12T12:00:00.000Z"),
            acceptedRole: "tutor",
            clinicId: fixture.clinicId,
            contactId: tutor.id,
            declaration: WHATSAPP_TUTOR_PATIENT_CONSENT_DECLARATION,
            identityId: whatsappIdentity.id,
            interactionId: `fixture-tutor-patient-consent-${fixture.clinicId}`,
            patientId: fixture.patientId,
            phoneE164: "+50370000003",
            privacyVersion: policy.privacyVersion,
            provider: "kapso",
            scope: "patient",
            termsVersion: policy.termsVersion,
            textReference: policy.immutableTextReference,
          });
        });
        const patientConsentReferences =
          await inWhatsAppInboundWorkerTransaction(async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            const consents = await transaction
              .select({
                contactId: whatsappContactConsents.contactId,
                id: whatsappContactConsents.id,
              })
              .from(whatsappContactConsents)
              .where(
                and(
                  eq(whatsappContactConsents.clinicId, fixture.clinicId),
                  eq(whatsappContactConsents.patientId, fixture.patientId),
                  eq(whatsappContactConsents.scope, "patient"),
                ),
              );
            const adultConsent = consents.find(
              (consent) => consent.contactId === fixture.contactId,
            );
            const tutorConsent = consents.find(
              (consent) => consent.contactId === tutor.id,
            );
            if (adultConsent === undefined || tutorConsent === undefined) {
              throw new Error("Falta el Consentimiento por Paciente vigente");
            }
            return { adult: adultConsent.id, tutor: tutorConsent.id };
          });
        const { adult: adultDelivery, tutor: tutorDelivery } =
          await inAppointmentSchedulerTransaction(async (transaction) => {
            const retainUntil = new Date("2027-08-12T12:00:00.000Z");
            const deliveries = [
              {
                contactId: fixture.contactId,
                idempotencyKey: `outbox-adult-consent-${fixture.clinicId}`,
                name: "Ana",
                phoneE164: fixture.contactPhone,
                role: "adult" as const,
              },
              {
                contactId: tutor.id,
                idempotencyKey: `outbox-tutor-consent-${fixture.clinicId}`,
                name: "Carlos Tutor",
                phoneE164: "+50370000003",
                role: "tutor" as const,
              },
            ];
            const created: {
              adult?: { id: string };
              tutor?: { id: string };
            } = {};
            for (const recipient of deliveries) {
              const [delivery] = await transaction
                .insert(transactionalDeliveries)
                .values({
                  appointmentId: confirmed.id,
                  clinicId: fixture.clinicId,
                  idempotencyKey: recipient.idempotencyKey,
                  kind: "appointment-reminder",
                  nextAttemptAt: now,
                  payload: {
                    appointmentId: confirmed.id,
                    appointmentStartsAt: "2026-08-17T14:00:00.000Z",
                    checkpoint: "24h",
                    clinicName: "Clínica de prueba",
                    recipient: {
                      id: recipient.contactId,
                      name: recipient.name,
                      phoneE164: recipient.phoneE164,
                    },
                  },
                  recipientContactId: recipient.contactId,
                  retainUntil,
                  status: "pending",
                })
                .returning({ id: transactionalDeliveries.id });
              if (delivery === undefined) {
                throw new Error("No se creó la Entrega del outbox");
              }
              created[recipient.role] = delivery;
            }
            const adult = created.adult;
            const tutorDelivery = created.tutor;
            if (adult === undefined || tutorDelivery === undefined) {
              throw new Error("Falta una Entrega del outbox por rol");
            }
            return { adult, tutor: tutorDelivery };
          });

        const claimedOutboxDeliveries =
          await drizzleTransactionalDeliveryStore.claimReadyDeliveries({ now });
        expect(claimedOutboxDeliveries.map((delivery) => delivery.id)).toEqual(
          expect.arrayContaining([adultDelivery.id, tutorDelivery.id]),
        );
        const outboxStates = await inClinicTransaction(
          fixture,
          async (transaction) =>
            transaction
              .select({
                id: transactionalDeliveries.id,
                patientConsentReference:
                  transactionalDeliveries.patientConsentReference,
                status: transactionalDeliveries.status,
              })
              .from(transactionalDeliveries)
              .where(
                inArray(transactionalDeliveries.id, [
                  adultDelivery.id,
                  tutorDelivery.id,
                ]),
              ),
        );
        expect(outboxStates).toEqual(
          expect.arrayContaining([
            {
              id: adultDelivery.id,
              patientConsentReference: patientConsentReferences.adult,
              status: "processing",
            },
            {
              id: tutorDelivery.id,
              patientConsentReference: patientConsentReferences.tutor,
              status: "processing",
            },
          ]),
        );

        const reminder = await sendAppointmentReminder(
          {
            appointmentId: confirmed.id,
            checkpoint: "24h",
            clinicId: fixture.clinicId,
            identityId: fixture.identityId,
            now: new Date("2026-08-16T14:00:00.000Z"),
          },
          drizzleManualAppointmentStore,
          simulatedAppointmentReminderSender,
        );
        expect(reminder.recipients.map((recipient) => recipient.id)).toEqual(
          expect.arrayContaining([fixture.contactId, tutor.id]),
        );
        expect(
          getSentSimulatedAppointmentReminders().some(
            (reminder) =>
              reminder.appointmentId === confirmed.id &&
              reminder.recipient.id === tutor.id,
          ),
        ).toBe(true);
        await processSimulatedWhatsAppMessage(
          message(fixture, "message-reply", "info"),
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        await expect(
          sendAppointmentReminder(
            {
              appointmentId: confirmed.id,
              checkpoint: "22h",
              clinicId: fixture.clinicId,
              identityId: fixture.identityId,
              now: new Date("2026-08-16T16:00:00.000Z"),
            },
            drizzleManualAppointmentStore,
            simulatedAppointmentReminderSender,
          ),
        ).resolves.toEqual({ recipients: [] });
        await inClinicTransaction(fixture, async (transaction) => {
          await expect(
            transaction
              .select({ authorContactId: appointments.authorContactId })
              .from(appointments)
              .where(eq(appointments.id, confirmed.id)),
          ).resolves.toEqual([{ authorContactId: fixture.contactId }]);
        });
        await expect(
          canContactManageAppointment(
            {
              appointmentId: confirmed.id,
              clinicId: fixture.clinicId,
              contactId: tutor.id,
            },
            drizzleAppointmentSelfManagementStore,
          ),
        ).resolves.toBe(false);
        await processSimulatedWhatsAppMessage(
          {
            from: "+50370000003",
            id: `${fixture.clinicId}-tutor-selects-patient`,
            text: `paciente ${fixture.patientId}`,
            to: fixture.whatsappNumber,
          },
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        const escalated = await processSimulatedWhatsAppMessage(
          {
            from: "+50370000003",
            id: `${fixture.clinicId}-tutor-cancels-appointment`,
            text: `cancelar ${confirmed.id}`,
            to: fixture.whatsappNumber,
          },
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        expect(escalated).toEqual({ kind: "conversation-silenced", text: "" });
        const escalation = await inClinicTransaction(fixture, (transaction) =>
          transaction
            .select({ id: appointmentSelfManagementEscalations.id })
            .from(appointmentSelfManagementEscalations)
            .where(
              eq(
                appointmentSelfManagementEscalations.appointmentId,
                confirmed.id,
              ),
            )
            .then((rows) => rows[0]),
        );
        if (escalation === undefined) {
          throw new Error("No se escaló la solicitud del Tutor");
        }
        await inClinicTransaction(fixture, async (transaction) => {
          await expect(
            transaction
              .select({
                action: appointmentSelfManagementEscalations.action,
                contactId: appointmentSelfManagementEscalations.contactId,
              })
              .from(appointmentSelfManagementEscalations)
              .where(
                eq(
                  appointmentSelfManagementEscalations.appointmentId,
                  confirmed.id,
                ),
              ),
          ).resolves.toEqual([{ action: "cancel", contactId: tutor.id }]);
        });
        await expect(
          processSimulatedWhatsAppMessage(
            {
              from: "+50370000003",
              id: `${fixture.clinicId}-tutor-after-escalation`,
              text: "info",
              to: fixture.whatsappNumber,
            },
            drizzleSimulatedWhatsAppBookingStore,
            now,
          ),
        ).resolves.toEqual({ kind: "conversation-silenced", text: "" });
        await expect(
          resolveAppointmentSelfManagementEscalation(
            {
              clinicId: fixture.clinicId,
              escalationId: escalation.id,
              identityId: fixture.identityId,
            },
            drizzleAppointmentSelfManagementEscalationResolver,
          ),
        ).resolves.toBe(true);
        await expect(
          processSimulatedWhatsAppMessage(
            {
              from: "+50370000003",
              id: `${fixture.clinicId}-tutor-after-close`,
              text: "info",
              to: fixture.whatsappNumber,
            },
            drizzleSimulatedWhatsAppBookingStore,
            now,
          ),
        ).resolves.toMatchObject({ kind: "public-information" });
        await expect(
          processSimulatedWhatsAppMessage(
            message(fixture, "message-4", "reservar 2026-08-17T14:00:00.000Z"),
            drizzleSimulatedWhatsAppBookingStore,
            now,
          ),
        ).resolves.toEqual(held);

        await inClinicTransaction(fixture.other, async (transaction) => {
          await expect(
            transaction
              .select({ id: appointments.id })
              .from(appointments)
              .where(eq(appointments.clinicId, fixture.clinicId)),
          ).resolves.toEqual([]);
          await expect(
            transaction
              .select({ id: simulatedWhatsAppMessages.id })
              .from(simulatedWhatsAppMessages)
              .where(eq(simulatedWhatsAppMessages.clinicId, fixture.clinicId)),
          ).resolves.toEqual([]);
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "reactiva solo Entregas de WhatsApp vigentes y conserva la cadencia bajo RLS",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-09-08T12:00:00.000Z");
      const appointmentStartsAt = new Date("2026-09-09T12:00:00.000Z");
      const staleAttemptAt = new Date("2026-09-08T11:40:00.000Z");
      const futureAttemptAt = new Date("2026-09-08T14:00:00.000Z");
      try {
        const appointmentIds = await inClinicTransaction(
          fixture,
          async (transaction) => {
            const doctor = await transaction.query.doctors.findFirst({
              columns: { id: true },
              where: eq(doctors.clinicId, fixture.clinicId),
            });
            if (doctor === undefined) throw new Error("Falta el Médico");
            const createAppointment = (startsAt: Date) =>
              transaction
                .insert(appointments)
                .values({
                  bufferMinutes: 0,
                  clinicId: fixture.clinicId,
                  doctorId: doctor.id,
                  durationMinutes: 30,
                  endsAt: new Date(startsAt.valueOf() + 30 * 60_000),
                  occupiedUntil: new Date(startsAt.valueOf() + 30 * 60_000),
                  origin: "manual",
                  patientId: fixture.patientId,
                  serviceOfferId: fixture.offerId,
                  startsAt,
                })
                .returning({ id: appointments.id });
            const [future] = await createAppointment(appointmentStartsAt);
            const [past] = await createAppointment(
              new Date("2026-09-08T11:00:00.000Z"),
            );
            if (future === undefined || past === undefined) {
              throw new Error("No se crearon las Citas de prueba");
            }
            return { future: future.id, past: past.id };
          },
        );

        const consentReference = await inWhatsAppInboundWorkerTransaction(
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            const identity =
              await transaction.query.whatsappIdentities.findFirst({
                columns: { id: true },
                where: and(
                  eq(whatsappIdentities.clinicId, fixture.clinicId),
                  eq(whatsappIdentities.contactId, fixture.contactId),
                ),
              });
            const termsContract =
              await transaction.query.clinicTermsContract.findFirst({
                columns: { currentVersion: true },
                where: eq(clinicTermsContract.id, true),
              });
            if (identity === undefined || termsContract === undefined) {
              throw new Error("Falta la evidencia de consentimiento");
            }
            const policy = buildWhatsAppConsentPolicy(
              termsContract.currentVersion,
            );
            const [consent] = await transaction
              .insert(whatsappContactConsents)
              .values({
                acceptedAt: now,
                acceptedRole: "contact",
                clinicId: fixture.clinicId,
                contactId: fixture.contactId,
                declaration: "CONTINUAR",
                identityId: identity.id,
                interactionId: `reactivation-${fixture.clinicId}`,
                patientId: null,
                phoneE164: fixture.contactPhone,
                privacyVersion: policy.privacyVersion,
                provider: "kapso",
                scope: "channel",
                status: "accepted",
                termsVersion: policy.termsVersion,
                textReference: policy.immutableTextReference,
              })
              .returning({ id: whatsappContactConsents.id });
            if (consent === undefined) {
              throw new Error("No se registró el nuevo consentimiento");
            }
            return consent.id;
          },
        );

        await inAppointmentSchedulerTransaction(async (transaction) => {
          const retainUntil = new Date("2027-09-08T12:00:00.000Z");
          const deliveries = [
            {
              appointmentId: appointmentIds.future,
              idempotencyKey: `reactivation-future-${fixture.clinicId}`,
              nextAttemptAt: futureAttemptAt,
            },
            {
              appointmentId: appointmentIds.future,
              idempotencyKey: `reactivation-stale-${fixture.clinicId}`,
              nextAttemptAt: staleAttemptAt,
            },
            {
              appointmentId: appointmentIds.past,
              idempotencyKey: `reactivation-past-${fixture.clinicId}`,
              nextAttemptAt: staleAttemptAt,
            },
          ];
          for (const delivery of deliveries) {
            await transaction.insert(transactionalDeliveries).values({
              appointmentId: delivery.appointmentId,
              clinicId: fixture.clinicId,
              idempotencyKey: delivery.idempotencyKey,
              kind: "appointment-reminder",
              lastError: "Consentimiento de WhatsApp no vigente",
              nextAttemptAt: delivery.nextAttemptAt,
              payload: {
                appointmentId: delivery.appointmentId,
                checkpoint: "24h",
                recipient: {
                  id: fixture.contactId,
                  name: "Ana",
                  phoneE164: fixture.contactPhone,
                },
              },
              recipientContactId: fixture.contactId,
              retainUntil,
              status: "suppressed",
            });
          }
        });

        await expect(
          reactivatePendingWhatsAppDeliveries({
            clinicId: fixture.clinicId,
            consentReference,
            contactId: fixture.contactId,
            now,
          }),
        ).resolves.toBe(1);

        const states = await inClinicTransaction(fixture, async (transaction) =>
          transaction
            .select({
              idempotencyKey: transactionalDeliveries.idempotencyKey,
              lastError: transactionalDeliveries.lastError,
              nextAttemptAt: transactionalDeliveries.nextAttemptAt,
              status: transactionalDeliveries.status,
            })
            .from(transactionalDeliveries)
            .where(eq(transactionalDeliveries.clinicId, fixture.clinicId)),
        );
        expect(states).toEqual(
          expect.arrayContaining([
            {
              idempotencyKey: `reactivation-future-${fixture.clinicId}`,
              lastError: null,
              nextAttemptAt: futureAttemptAt,
              status: "pending",
            },
            {
              idempotencyKey: `reactivation-stale-${fixture.clinicId}`,
              lastError: "Consentimiento de WhatsApp no vigente",
              nextAttemptAt: staleAttemptAt,
              status: "suppressed",
            },
            {
              idempotencyKey: `reactivation-past-${fixture.clinicId}`,
              lastError: "Consentimiento de WhatsApp no vigente",
              nextAttemptAt: staleAttemptAt,
              status: "suppressed",
            },
          ]),
        );
        await expect(
          reactivatePendingWhatsAppDeliveries({
            clinicId: fixture.other.clinicId,
            consentReference,
            contactId: fixture.contactId,
            now,
          }),
        ).resolves.toBe(0);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "persiste Escalamientos humanos y urgencias aislados por RLS",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-08-14T12:00:00.000Z");
      try {
        await expect(
          processSimulatedWhatsAppMessage(
            message(fixture, "human-request", "Quiero hablar con una persona"),
            drizzleSimulatedWhatsAppBookingStore,
            now,
          ),
        ).resolves.toEqual({ kind: "conversation-silenced", text: "" });
        const escalations = await listConversationEscalations(
          fixture,
          drizzleConversationEscalationReader,
        );
        expect(escalations).toMatchObject([
          { contact: { id: fixture.contactId }, trigger: "human-request" },
        ]);
        await expect(
          listConversationEscalations(
            fixture.other,
            drizzleConversationEscalationReader,
          ),
        ).resolves.toEqual([]);
        const escalation = escalations[0];
        if (escalation === undefined) throw new Error("Falta el Escalamiento");
        await expect(
          resolveConversationEscalation(
            { ...fixture, escalationId: escalation.id },
            drizzleConversationEscalationResolver,
          ),
        ).resolves.toBe(true);
        await expect(
          processSimulatedWhatsAppMessage(
            message(fixture, "urgency", "Tengo una urgencia médica"),
            drizzleSimulatedWhatsAppBookingStore,
            now,
          ),
        ).resolves.toMatchObject({ kind: "urgent-protocol" });
        await inClinicTransaction(fixture, async (transaction) => {
          await expect(
            transaction
              .select({ type: conversationEvents.type })
              .from(conversationEvents),
          ).resolves.toEqual([{ type: "urgency-protocol" }]);
        });
        await inClinicTransaction(fixture.other, async (transaction) => {
          await expect(
            transaction
              .select({ id: conversationEscalations.id })
              .from(conversationEscalations)
              .where(eq(conversationEscalations.clinicId, fixture.clinicId)),
          ).resolves.toEqual([]);
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "activa el takeover de coexistencia bajo RLS y lo aísla por Clínica",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-09-08T12:00:00.000Z");
      const messageId = `${fixture.clinicId}-business-app`;
      try {
        await activateWhatsAppHumanTakeover(
          {
            clinicId: fixture.clinicId,
            contactId: fixture.contactId,
            messageId,
            messageType: "text",
            now,
            trigger: "business-app",
          },
          drizzleSimulatedWhatsAppBookingStore,
        );
        await expect(
          listConversationEscalations(
            fixture,
            drizzleConversationEscalationReader,
          ),
        ).resolves.toMatchObject([
          { contact: { id: fixture.contactId }, trigger: "business-app" },
        ]);
        await inClinicTransaction(fixture, async (transaction) => {
          const conversation =
            await transaction.query.whatsappConversations.findFirst({
              columns: { state: true },
              where: and(
                eq(whatsappConversations.clinicId, fixture.clinicId),
                eq(whatsappConversations.contactId, fixture.contactId),
              ),
            });
          expect(conversation?.state.escalationId).not.toBeNull();
        });
        const escalation = (
          await listConversationEscalations(
            fixture,
            drizzleConversationEscalationReader,
          )
        )[0];
        if (escalation === undefined) throw new Error("Falta el takeover");
        await expect(
          resolveConversationEscalationWithAudit(
            { ...fixture, escalationId: escalation.id },
            drizzleConversationEscalationResolver,
          ),
        ).resolves.toMatchObject({
          resolvedBy: { name: fixture.identityId },
        });
        await expect(
          processSimulatedWhatsAppMessage(
            message(fixture, "business-app-resumed", "info"),
            drizzleSimulatedWhatsAppBookingStore,
            now,
          ),
        ).resolves.toMatchObject({ kind: "public-information" });
        await activateWhatsAppHumanTakeover(
          {
            clinicId: fixture.clinicId,
            contactId: fixture.contactId,
            messageId,
            messageType: "text",
            now,
            trigger: "business-app",
          },
          drizzleSimulatedWhatsAppBookingStore,
        );
        await expect(
          isWhatsAppHumanTakeoverActive(
            { clinicId: fixture.clinicId, contactId: fixture.contactId },
            drizzleSimulatedWhatsAppBookingStore,
          ),
        ).resolves.toBe(false);
        await expect(
          inClinicTransaction(fixture.other, (transaction) =>
            transaction
              .select({ id: conversationEscalations.id })
              .from(conversationEscalations),
          ),
        ).resolves.toEqual([]);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "expone el tipo del mensaje escalado en la bandeja sin cruzar Clínicas",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-09-08T12:00:00.000Z");
      try {
        await activateWhatsAppHumanTakeover(
          {
            clinicId: fixture.clinicId,
            contactId: fixture.contactId,
            messageId: `${fixture.clinicId}-audio`,
            messageType: "audio",
            now,
            trigger: "unsupported-message",
          },
          drizzleSimulatedWhatsAppBookingStore,
        );
        await activateWhatsAppHumanTakeover(
          {
            clinicId: fixture.clinicId,
            contactId: fixture.contactId,
            messageId: `${fixture.clinicId}-image-after-audio`,
            messageType: "image",
            now: new Date(now.valueOf() + 1_000),
            trigger: "unsupported-message",
          },
          drizzleSimulatedWhatsAppBookingStore,
        );

        await expect(
          listConversationEscalations(
            fixture,
            drizzleConversationEscalationReader,
          ),
        ).resolves.toMatchObject([
          {
            contact: { id: fixture.contactId },
            sourceMessageType: "audio",
            trigger: "unsupported-message",
          },
        ]);
        await expect(
          listPendingCases(
            {
              category: "conversation",
              clinicId: fixture.clinicId,
              identityId: fixture.identityId,
              status: "open",
            },
            drizzlePendingStore,
          ),
        ).resolves.toMatchObject({
          items: [
            {
              category: "conversation",
              sourceMessageType: "audio",
            },
          ],
        });
        await expect(
          listConversationEscalations(
            fixture.other,
            drizzleConversationEscalationReader,
          ),
        ).resolves.toEqual([]);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "confirma el aviso de takeover sólo después de aceptar el envío",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-09-08T12:00:00.000Z");
      try {
        await activateWhatsAppHumanTakeover(
          {
            clinicId: fixture.clinicId,
            contactId: fixture.contactId,
            messageId: `${fixture.clinicId}-business-app-notification`,
            messageType: "text",
            now,
            trigger: "business-app",
          },
          drizzleSimulatedWhatsAppBookingStore,
        );
        const [escalation] = await inClinicTransaction(fixture, (transaction) =>
          transaction
            .select({
              id: conversationEscalations.id,
              notificationSentAt: conversationEscalations.notificationSentAt,
            })
            .from(conversationEscalations)
            .where(eq(conversationEscalations.clinicId, fixture.clinicId)),
        );
        if (escalation === undefined) throw new Error("Falta el takeover");
        expect(escalation.notificationSentAt).toBeNull();

        await drizzleWhatsAppInboundStore.enqueueReply({
          clinicId: fixture.clinicId,
          idempotencyKey: `escalation:${escalation.id}`,
          recipientBusinessScopedUserId: null,
          recipientPhoneE164: "+50370000003",
          text: "Una persona te contactará pronto.",
        });
        const processingNow = new Date();
        const [reply] = await drizzleWhatsAppInboundStore.claimDueReplies({
          limit: 1,
          now: processingNow,
        });
        const replyId = reply?.id;
        const leaseToken = reply?.leaseToken;
        if (
          replyId === undefined ||
          leaseToken === undefined ||
          leaseToken === null
        ) {
          throw new Error("Falta el aviso en el outbox");
        }
        await drizzleWhatsAppInboundStore.markAcceptedReply({
          id: replyId,
          leaseToken,
          now: processingNow,
          providerMessageId: "wamid-takeover-notification",
        });
        await expect(
          inSuperadminTransaction(fixture.superadminIdentityId, (transaction) =>
            transaction
              .select({
                idempotencyKey: whatsappInboundReplies.idempotencyKey,
                status: whatsappInboundReplies.status,
              })
              .from(whatsappInboundReplies)
              .where(eq(whatsappInboundReplies.id, replyId)),
          ),
        ).resolves.toEqual([
          {
            idempotencyKey: `escalation:${escalation.id}`,
            status: "accepted",
          },
        ]);

        await expect(
          inClinicTransaction(fixture, (transaction) =>
            transaction
              .select({
                notificationSentAt: conversationEscalations.notificationSentAt,
              })
              .from(conversationEscalations)
              .where(eq(conversationEscalations.id, escalation.id)),
          ),
        ).resolves.toEqual([{ notificationSentAt: processingNow }]);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "procesa por phone_number_id un mensaje v2 sin customer y lo entrega una sola vez",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-09-08T12:00:00.000Z");
      const phoneNumberId = `kapso-phone-${fixture.clinicId}`;
      const messageId = `wamid-${fixture.clinicId}-without-customer`;
      const idempotencyKey = `kapso-inbound-${fixture.clinicId}`;
      const assistantCalls: Parameters<
        WhatsAppInboundAssistant["processText"]
      >[0][] = [];
      const message: WhatsAppInboundMessage = {
        batchFirstSequence: 101,
        batchSequence: 101,
        businessScopedUserId: null,
        conversationId: `conversation-${fixture.contactId}`,
        customerReference: null,
        direction: "inbound",
        eventName: "whatsapp.message.received",
        fromWaId: fixture.contactPhone,
        id: messageId,
        interactiveAction: null,
        messageTimestamp: new Date(now.valueOf() - 60_000),
        origin: "api",
        parentBusinessScopedUserId: null,
        phoneE164: fixture.contactPhone,
        connectionReference: phoneNumberId,
        rawPayload: { message: { id: messageId } },
        text: "info",
        type: "text",
        username: null,
      };

      try {
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction
              .update(whatsappConnections)
              .set({
                connectionType: "coexistence",
                customer: `kapso-customer-${fixture.clinicId}`,
                phoneNumberId,
                provider: "kapso",
                status: "ready",
              })
              .where(eq(whatsappConnections.clinicId, fixture.clinicId));
          },
        );
        await inWhatsAppInboundWorkerTransaction(async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
          );
          await transaction
            .update(whatsappIdentities)
            .set({ phoneNumberId })
            .where(
              and(
                eq(whatsappIdentities.clinicId, fixture.clinicId),
                eq(whatsappIdentities.contactId, fixture.contactId),
              ),
            );
        });

        await expect(
          drizzleWhatsAppInboundStore.enqueueInbound({
            idempotencyKey,
            message,
          }),
        ).resolves.toMatchObject({ accepted: true });

        const assistant: WhatsAppInboundAssistant = {
          processText: async (input) => {
            assistantCalls.push(input);
            return { text: "Servicios disponibles." };
          },
        };
        const result = await runKapsoInboundWorker(
          { now },
          drizzleWhatsAppInboundStore,
          assistant,
          createWhatsAppConsentGate(drizzleWhatsAppInboundStore),
          { send: async () => undefined },
          undefined,
          {
            activate: async () => undefined,
            isActive: async () => false,
          },
        );

        expect(result).toMatchObject({
          claimed: 1,
          processed: 1,
          rejected: 0,
          retried: 0,
        });
        expect(assistantCalls).toEqual([
          expect.objectContaining({
            clinicId: fixture.clinicId,
            contactId: fixture.contactId,
            messageId,
            text: "info",
          }),
        ]);
        const stored = await inSuperadminTransaction(
          fixture.superadminIdentityId,
          (transaction) =>
            transaction
              .select({
                clinicId: whatsappInboundMessages.clinicId,
                contactId: whatsappInboundMessages.contactId,
                identityId: whatsappInboundMessages.identityId,
                status: whatsappInboundMessages.status,
              })
              .from(whatsappInboundMessages)
              .where(
                eq(whatsappInboundMessages.idempotencyKey, idempotencyKey),
              ),
        );
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({
          clinicId: fixture.clinicId,
          contactId: fixture.contactId,
          status: "processed",
        });
        expect(stored[0]?.identityId).toBeTypeOf("string");
      } finally {
        await db
          .delete(whatsappInboundMessages)
          .where(eq(whatsappInboundMessages.idempotencyKey, idempotencyKey));
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "procesa un lote Kapso fuera de orden sin duplicar efectos",
    async () => {
      const phoneNumberId = `kapso-ordering-${randomUUID()}`;
      const conversationId = `conversation-ordering-${randomUUID()}`;
      const firstSequence = 501;
      const makeMessage = (sequence: number): WhatsAppInboundMessage => ({
        batchFirstSequence: firstSequence,
        batchSequence: sequence,
        businessScopedUserId: null,
        conversationId,
        customerReference: null,
        direction: "inbound",
        eventName: "whatsapp.message.received",
        fromWaId: "+50370000009",
        id: `${phoneNumberId}-${sequence}`,
        interactiveAction: null,
        messageTimestamp: new Date(),
        origin: "api",
        parentBusinessScopedUserId: null,
        phoneE164: "+50370000009",
        connectionReference: phoneNumberId,
        rawPayload: { message: { id: `${phoneNumberId}-${sequence}` } },
        text: "info",
        type: "text",
        username: null,
      });

      try {
        await drizzleWhatsAppInboundStore.enqueueInbound({
          idempotencyKey: `${phoneNumberId}-502`,
          message: makeMessage(502),
        });
        const firstClaimAt = new Date();
        await expect(
          drizzleWhatsAppInboundStore.claimDueMessages({
            limit: 10,
            now: firstClaimAt,
          }),
        ).resolves.toMatchObject([
          { batchFirstSequence: firstSequence, batchSequence: 502 },
        ]);

        await drizzleWhatsAppInboundStore.enqueueInbound({
          idempotencyKey: `${phoneNumberId}-501`,
          message: makeMessage(501),
        });
        const claimed = await drizzleWhatsAppInboundStore.claimDueMessages({
          limit: 10,
          now: new Date(firstClaimAt.valueOf() + 1_000),
        });
        expect(claimed.map(({ batchSequence }) => batchSequence)).toEqual([
          501,
        ]);
      } finally {
        await db
          .delete(whatsappInboundMessages)
          .where(eq(whatsappInboundMessages.phoneNumberId, phoneNumberId));
      }
    },
  );

  databaseTest(
    "permite a Apolo corregir y reencolar un inbound rechazado sin asignarlo antes de tiempo",
    async () => {
      const fixture = await createFixture();
      const phoneNumberId = `kapso-unknown-${fixture.clinicId}`;
      const idempotencyKey = `kapso-unknown-${fixture.clinicId}`;
      const messageId = `${idempotencyKey}-message`;
      const message: WhatsAppInboundMessage = {
        batchFirstSequence: null,
        batchSequence: null,
        businessScopedUserId: null,
        conversationId: null,
        customerReference: "customer-not-configured",
        direction: "inbound",
        eventName: "whatsapp.message.received",
        fromWaId: "+50370000009",
        id: messageId,
        interactiveAction: null,
        messageTimestamp: new Date(),
        origin: "api",
        parentBusinessScopedUserId: null,
        phoneE164: "+50370000009",
        connectionReference: phoneNumberId,
        rawPayload: { message: { id: messageId } },
        text: "info",
        type: "text",
        username: null,
      };

      try {
        await expect(
          drizzleWhatsAppInboundStore.enqueueInbound({
            idempotencyKey,
            message,
          }),
        ).resolves.toMatchObject({ accepted: true });
        const workerResult = await runKapsoInboundWorker(
          { now: new Date() },
          drizzleWhatsAppInboundStore,
          { processText: async () => ({ text: "no debe ejecutarse" }) },
          createWhatsAppConsentGate(drizzleWhatsAppInboundStore),
          { send: async () => undefined },
          undefined,
          { activate: async () => undefined, isActive: async () => false },
        );
        expect(workerResult).toMatchObject({ rejected: 1 });

        const [alert] = await listWhatsAppInboundOperationalAlerts({
          identityId: fixture.superadminIdentityId,
        });
        expect(alert).toMatchObject({
          connectionReference: message.connectionReference,
          customerReference: message.customerReference,
          status: "open",
        });
        if (alert === undefined) throw new Error("Falta la alerta inbound");
        expect(alert.inboundMessageId).toBeTypeOf("string");

        await expect(
          resolveWhatsAppInboundOperationalAlert({
            alertId: alert.id,
            identityId: fixture.superadminIdentityId,
            now: new Date(),
          }),
        ).resolves.toBe(true);
        await expect(
          listWhatsAppInboundOperationalAlerts({
            identityId: fixture.superadminIdentityId,
          }),
        ).resolves.toEqual([]);
        await expect(
          inSuperadminTransaction(fixture.superadminIdentityId, (transaction) =>
            transaction
              .select({
                alertStatus: whatsappInboundAlerts.status,
                messageStatus: whatsappInboundMessages.status,
                resolvedByIdentityId:
                  whatsappInboundAlerts.resolvedByIdentityId,
              })
              .from(whatsappInboundAlerts)
              .innerJoin(
                whatsappInboundMessages,
                eq(
                  whatsappInboundAlerts.inboundMessageId,
                  whatsappInboundMessages.id,
                ),
              )
              .where(eq(whatsappInboundAlerts.id, alert.id)),
          ),
        ).resolves.toMatchObject([
          {
            alertStatus: "resolved",
            messageStatus: "pending",
            resolvedByIdentityId: fixture.superadminIdentityId,
          },
        ]);
      } finally {
        await db
          .delete(whatsappInboundMessages)
          .where(eq(whatsappInboundMessages.idempotencyKey, idempotencyKey));
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "registra la tutela pendiente, la expone a Panacea y oculta al menor de Contactos no vinculados",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-08-12T14:00:00.000Z");
      try {
        const registered = await processSimulatedWhatsAppMessage(
          message(
            fixture,
            "minor-1",
            "registrar menor|Lucía Pérez|01234567-8|2018-04-02|DECLARO REPRESENTACIÓN AUTORIZADA",
          ),
          drizzleSimulatedWhatsAppBookingStore,
          now,
        );
        if (registered.kind !== "guardianship-pending") {
          throw new Error("No se registró el menor");
        }
        const tasks = await listPendingGuardianshipVerifications(
          fixture,
          drizzleAdministrativeRecordsStore,
        );
        expect(tasks).toHaveLength(1);
        expect(tasks[0]?.guardianDui).toBe("01234567-8");
        const registeredPatientId = tasks[0]?.patient.id;
        if (registeredPatientId === undefined) {
          throw new Error("No se conservó el menor para verificación");
        }
        await expect(
          listPendingGuardianshipVerifications(
            fixture.other,
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toEqual([]);

        await inClinicTransaction(fixture, async (transaction) => {
          await transaction.insert(contacts).values({
            clinicId: fixture.clinicId,
            name: "Carlos",
            phoneE164: "+50370000003",
          });
        });
        const privateMessage = (id: string, patientId: string) =>
          processSimulatedWhatsAppMessage(
            {
              from: "+50370000003",
              id: `${fixture.clinicId}-${id}`,
              text: `paciente ${patientId}`,
              to: fixture.whatsappNumber,
            },
            drizzleSimulatedWhatsAppBookingStore,
            now,
          );
        await expect(
          privateMessage("minor-privacy", registeredPatientId),
        ).resolves.toEqual(
          await privateMessage(
            "missing-privacy",
            "patient-that-does-not-exist",
          ),
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

function message(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  id: string,
  text: string,
) {
  return {
    from: fixture.contactPhone,
    id: `${fixture.clinicId}-${id}`,
    text,
    to: fixture.whatsappNumber,
  };
}

async function createFixture() {
  const suffix = randomUUID();
  const ownerIdentityId = `apo-18-owner-${suffix}`;
  const otherIdentityId = `apo-18-other-${suffix}`;
  const superadminIdentityId = `apo-18-superadmin-${suffix}`;
  const whatsappNumber = `+5037${Date.now().toString().slice(-7)}`;
  const contactPhone = "+50370000002";
  await db.insert(identities).values(
    [ownerIdentityId, otherIdentityId, superadminIdentityId].map((id) => ({
      createdAt: new Date(),
      email: `${id}@example.test`,
      emailVerified: true,
      id,
      name: id,
      updatedAt: new Date(),
    })),
  );
  await db
    .insert(apoloSuperadmins)
    .values({ identityId: superadminIdentityId });
  const createClinic = (identityId: string, name: string, number?: string) =>
    inSuperadminTransaction(superadminIdentityId, async (transaction) => {
      const [clinic] = await transaction
        .insert(clinics)
        .values({
          isSynthetic: true,
          name,
        })
        .returning({ id: clinics.id });
      if (clinic === undefined) throw new Error("No se creó la Clínica");
      await transaction.execute(
        sql`select set_config('app.clinic_id', ${clinic.id}, true)`,
      );
      await transaction.insert(whatsappConnections).values({
        ...createSimulatedWhatsAppConnection(clinic.id),
        phoneNumberE164: number ?? null,
      });
      await transaction.insert(clinicUsers).values({
        clinicId: clinic.id,
        identityId,
        role: "owner",
      });
      return { clinicId: clinic.id, identityId };
    });
  const primary = await createClinic(
    ownerIdentityId,
    "Clínica APO-18",
    whatsappNumber,
  );
  const other = await createClinic(otherIdentityId, "Otra Clínica APO-18");
  const records = await inClinicTransaction(primary, async (transaction) => {
    const owner = await transaction.query.clinicUsers.findFirst({
      columns: { id: true },
      where: and(
        eq(clinicUsers.clinicId, primary.clinicId),
        eq(clinicUsers.identityId, ownerIdentityId),
      ),
    });
    if (owner === undefined) throw new Error("Falta el propietario");
    const [doctor] = await transaction
      .insert(doctors)
      .values({
        clinicId: primary.clinicId,
        clinicUserId: owner.id,
        publicName: "Dra. Sol",
        primarySpecialty: "Medicina familiar",
      })
      .returning({ id: doctors.id });
    const [service] = await transaction
      .insert(services)
      .values({
        clinicId: primary.clinicId,
        description: "Consulta administrativa",
        name: "Consulta",
        normalizedName: "consulta",
      })
      .returning({ id: services.id });
    if (doctor === undefined || service === undefined)
      throw new Error("Falta la configuración de Agenda");
    const [offer] = await transaction
      .insert(serviceOffers)
      .values({
        bufferMinutes: 0,
        clinicId: primary.clinicId,
        doctorId: doctor.id,
        durationMinutes: 30,
        priceUsd: "25.00",
        serviceId: service.id,
      })
      .returning({ id: serviceOffers.id });
    const [schedule] = await transaction
      .insert(effectiveSchedules)
      .values({
        clinicId: primary.clinicId,
        doctorId: doctor.id,
        effectiveFrom: "2026-08-01",
        timezone: "America/El_Salvador",
      })
      .returning({ id: effectiveSchedules.id });
    if (offer === undefined || schedule === undefined)
      throw new Error("Falta Oferta u Horario");
    await transaction.insert(effectiveSchedulePeriods).values({
      clinicId: primary.clinicId,
      dayOfWeek: 1,
      doctorId: doctor.id,
      endTime: "10:00",
      scheduleId: schedule.id,
      startTime: "08:00",
    });
    const [contact] = await transaction
      .insert(contacts)
      .values({
        clinicId: primary.clinicId,
        name: "Ana",
        phoneE164: contactPhone,
      })
      .returning({ id: contacts.id });
    const [patient] = await transaction
      .insert(patients)
      .values({
        birthDate: "1990-01-01",
        clinicId: primary.clinicId,
        name: "Ana",
      })
      .returning({ id: patients.id });
    if (contact === undefined || patient === undefined)
      throw new Error("Falta Contacto o Paciente");
    await transaction.insert(contactPatientLinks).values({
      clinicId: primary.clinicId,
      contactId: contact.id,
      patientId: patient.id,
    });
    return { contactId: contact.id, offerId: offer.id, patientId: patient.id };
  });
  await inWhatsAppInboundWorkerTransaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.clinic_id', ${primary.clinicId}, true)`,
    );
    const termsContract = await transaction.query.clinicTermsContract.findFirst(
      {
        columns: { currentVersion: true },
        where: eq(clinicTermsContract.id, true),
      },
    );
    if (termsContract === undefined) {
      throw new Error("Falta el Contrato de términos de prueba");
    }
    const policy = buildWhatsAppConsentPolicy(termsContract.currentVersion);
    const [whatsappIdentity] = await transaction
      .insert(whatsappIdentities)
      .values({
        clinicId: primary.clinicId,
        contactId: records.contactId,
        phoneE164: contactPhone,
        phoneNumberId: `simulated-${primary.clinicId}`,
        status: "active",
      })
      .returning({ id: whatsappIdentities.id });
    if (whatsappIdentity === undefined) {
      throw new Error("Falta la Identidad de WhatsApp de prueba");
    }
    await transaction.insert(whatsappContactConsents).values({
      acceptedAt: new Date("2026-08-12T12:00:00.000Z"),
      acceptedRole: "contact",
      clinicId: primary.clinicId,
      contactId: records.contactId,
      declaration: "CONTINUAR",
      identityId: whatsappIdentity.id,
      interactionId: `fixture-consent-${primary.clinicId}`,
      patientId: null,
      phoneE164: contactPhone,
      privacyVersion: policy.privacyVersion,
      provider: "kapso",
      scope: "channel",
      termsVersion: policy.termsVersion,
      textReference: policy.immutableTextReference,
    });
    await transaction.insert(whatsappContactConsents).values({
      acceptedAt: new Date("2026-08-12T12:00:00.000Z"),
      acceptedRole: "adult-patient",
      clinicId: primary.clinicId,
      contactId: records.contactId,
      declaration: WHATSAPP_ADULT_PATIENT_CONSENT_DECLARATION,
      identityId: whatsappIdentity.id,
      interactionId: `fixture-patient-consent-${primary.clinicId}`,
      patientId: records.patientId,
      phoneE164: contactPhone,
      privacyVersion: policy.privacyVersion,
      provider: "kapso",
      scope: "patient",
      termsVersion: policy.termsVersion,
      textReference: policy.immutableTextReference,
    });
  });
  return {
    ...primary,
    ...records,
    contactPhone,
    other,
    superadminIdentityId,
    whatsappNumber,
    async cleanup() {
      await inClinicTransaction(primary, (transaction) =>
        transaction
          .delete(appointments)
          .where(eq(appointments.clinicId, primary.clinicId)),
      );
      await inSuperadminTransaction(
        superadminIdentityId,
        async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${primary.clinicId}, true)`,
          );
          await transaction
            .delete(transactionalDeliveryAlerts)
            .where(eq(transactionalDeliveryAlerts.clinicId, primary.clinicId));
          await transaction
            .delete(transactionalDeliveries)
            .where(eq(transactionalDeliveries.clinicId, primary.clinicId));
          await transaction
            .delete(conversationEscalations)
            .where(eq(conversationEscalations.clinicId, primary.clinicId));
          await transaction
            .delete(appointmentSelfManagementEscalations)
            .where(
              eq(
                appointmentSelfManagementEscalations.clinicId,
                primary.clinicId,
              ),
            );
          await transaction
            .delete(whatsappContactConsents)
            .where(eq(whatsappContactConsents.clinicId, primary.clinicId));
          await transaction
            .delete(whatsappIdentities)
            .where(eq(whatsappIdentities.clinicId, primary.clinicId));
          await transaction
            .delete(clinics)
            .where(eq(clinics.id, primary.clinicId));
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${other.clinicId}, true)`,
          );
          await transaction
            .delete(clinics)
            .where(eq(clinics.id, other.clinicId));
        },
      );
      await db.delete(identities).where(eq(identities.id, ownerIdentityId));
      await db.delete(identities).where(eq(identities.id, otherIdentityId));
      await db
        .delete(identities)
        .where(eq(identities.id, superadminIdentityId));
    },
  };
}
