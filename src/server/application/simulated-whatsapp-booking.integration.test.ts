import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  appointmentEventTypes,
  appointmentOutboundEventTypes,
} from "~/domain/appointment-events";
import { evaluateWhatsAppSyntheticSmoke } from "~/domain/whatsapp-smoke";
import { buildWhatsAppConsentPolicy } from "~/domain/whatsapp-consent";
import { createSimulatedWhatsAppConnection } from "~/domain/whatsapp-connection";
import type { WhatsAppInboundMessage } from "~/domain/whatsapp-inbound";
import { createWhatsAppConsentGate } from "./whatsapp-consent";
import {
  runKapsoInboundWorker,
  type WhatsAppInboundAssistant,
} from "./whatsapp-inbound";
import { receiveKapsoWebhook } from "./whatsapp-provisioning";
import {
  activateWhatsAppHumanTakeover,
  isWhatsAppHumanTakeoverActive,
  processWhatsAppTextForContact,
  processSimulatedWhatsAppMessage,
} from "./simulated-whatsapp-booking";
import {
  getPatientAdministrativeDetail,
  listPendingGuardianshipVerifications,
} from "./administrative-records";
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
  inWhatsAppOutboundWorkerTransaction,
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
import { readWhatsAppConsentSnapshot } from "../db/whatsapp-consent-query";
import {
  drizzleTransactionalDeliveryStore,
  drizzleTransactionalDeliveryCallbackStore,
  reactivatePendingWhatsAppDeliveries,
} from "../db/transactional-delivery-store";
import { drizzleWhatsAppInboundStore } from "../db/whatsapp-inbound-store";
import { drizzleWhatsAppProvisioningStore } from "../db/whatsapp-provisioning-store";
import { createKapsoInboundReplySender } from "../whatsapp/kapso-whatsapp";
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
  whatsappCriticalTemplates,
  whatsappContactConsents,
  whatsappConnections,
  whatsappConversations,
  whatsappIdentities,
  whatsappInboundMessages,
  whatsappInboundAlerts,
  whatsappInboundReplies,
  whatsappSmokeRuns,
} from "../db/schema";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("Reserva simulada de WhatsApp persistente", () => {
  databaseTest(
    "correlaciona la entrega de una respuesta smoke por phone number ID",
    async () => {
      const fixture = await createFixture();
      const now = new Date();
      const smokeRunId = randomUUID();
      const phoneNumberId = `phone-${randomUUID()}`;
      const providerMessageId = `wamid-smoke-${randomUUID()}`;
      const providerEventId = `kapso-event-${randomUUID()}`;
      const idempotencyKey = `whatsapp-smoke:${smokeRunId}:reply`;
      const timeoutAt = new Date(now.valueOf() + 5 * 60_000);
      const smoke = evaluateWhatsAppSyntheticSmoke({
        realPatientsEnabled: false,
        requireRealRoundtrip: true,
        steps: {
          "real-processing": {
            evidence: "Mensaje de prueba procesado",
            eventId: `inbound-${smokeRunId}`,
            observedAt: now,
            passed: true,
            source: "application",
            status: "passed",
          },
          "real-reception": {
            evidence: "Mensaje de prueba recibido",
            eventId: `inbound-${smokeRunId}`,
            observedAt: now,
            passed: true,
            source: "provider",
            status: "passed",
          },
          "real-response": {
            evidence: "Respuesta aceptada por Kapso",
            eventId: `response-${smokeRunId}`,
            observedAt: now,
            passed: true,
            source: "provider",
            status: "passed",
          },
        },
        syntheticContact: false,
        testContactId: fixture.contactId,
        testContactMaskedPhone: "••••0264",
        timeoutAt,
      });
      try {
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            await transaction
              .update(whatsappConnections)
              .set({
                connectionType: "coexistence",
                phoneNumberId,
                provider: "kapso",
              })
              .where(eq(whatsappConnections.clinicId, fixture.clinicId));
            await transaction.insert(whatsappSmokeRuns).values({
              actorIdentityId: fixture.superadminIdentityId,
              clinicId: fixture.clinicId,
              id: smokeRunId,
              providerTransportVerified: true,
              realPatientsEnabled: false,
              requiresRealRoundtrip: true,
              startedAt: now,
              status: "pending",
              steps: smoke.steps,
              syntheticContact: false,
              testContactId: fixture.contactId,
              testContactMaskedPhone: "••••0264",
              timeoutAt,
            });
            await transaction.insert(whatsappInboundReplies).values({
              clinicId: fixture.clinicId,
              idempotencyKey,
              nextAttemptAt: now,
              providerMessageId,
              recipientPhoneE164: fixture.contactPhone,
              status: "accepted",
              text: "Respuesta de prueba",
            });
          },
        );

        await drizzleTransactionalDeliveryCallbackStore.recordProviderCallback({
          phoneNumberId,
          providerEventId,
          providerMessageId,
          status: "delivered",
        });

        const state = await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            const [reply] = await transaction
              .select({ status: whatsappInboundReplies.status })
              .from(whatsappInboundReplies)
              .where(eq(whatsappInboundReplies.idempotencyKey, idempotencyKey));
            const [run] = await transaction
              .select({ steps: whatsappSmokeRuns.steps })
              .from(whatsappSmokeRuns)
              .where(eq(whatsappSmokeRuns.id, smokeRunId));
            return {
              deliveryStep: run?.steps.find(
                (step) => step.code === "real-delivery",
              ),
              replyStatus: reply?.status,
            };
          },
        );

        expect(state.replyStatus).toBe("delivered");
        expect(state.deliveryStep).toMatchObject({
          eventId: providerEventId,
          passed: true,
          source: "provider",
          status: "passed",
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "el consentimiento del Contacto cubre Pacientes futuros y Tutores pendientes vinculados, pero no Pacientes sin vínculo",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-08-14T12:00:00.000Z");
      try {
        const linkedPatientIds = await inClinicTransaction(
          fixture,
          async (transaction) => {
            const [futurePatient, pendingTutorPatient, unlinkedPatient] =
              await transaction
                .insert(patients)
                .values([
                  {
                    birthDate: "1988-05-01",
                    clinicId: fixture.clinicId,
                    name: "Paciente vinculado después",
                  },
                  {
                    birthDate: "2018-05-01",
                    clinicId: fixture.clinicId,
                    name: "Paciente con Tutor pendiente",
                  },
                  {
                    birthDate: "2015-05-01",
                    clinicId: fixture.clinicId,
                    name: "Paciente sin vínculo",
                  },
                ])
                .returning({ id: patients.id });
            if (
              futurePatient === undefined ||
              pendingTutorPatient === undefined ||
              unlinkedPatient === undefined
            ) {
              throw new Error("No se crearon los Pacientes de prueba");
            }
            await transaction.insert(contactPatientLinks).values([
              {
                clinicId: fixture.clinicId,
                contactId: fixture.contactId,
                patientId: futurePatient.id,
              },
              {
                clinicId: fixture.clinicId,
                contactId: fixture.contactId,
                guardianDui: "01234567-8",
                guardianshipVerificationStatus: "pending",
                patientId: pendingTutorPatient.id,
                relationship: "tutor",
              },
            ]);
            return {
              futurePatientId: futurePatient.id,
              pendingTutorPatientId: pendingTutorPatient.id,
              unlinkedPatientId: unlinkedPatient.id,
            };
          },
        );

        const snapshotFor = (patientId: string) =>
          inClinicTransaction(fixture, (transaction) =>
            readWhatsAppConsentSnapshot(transaction, {
              clinicId: fixture.clinicId,
              contactId: fixture.contactId,
              now,
              patientId,
            }),
          );

        await expect(snapshotFor(fixture.patientId)).resolves.toMatchObject({
          decision: "allowed",
          patientReference: null,
        });
        await expect(
          snapshotFor(linkedPatientIds.futurePatientId),
        ).resolves.toMatchObject({
          decision: "allowed",
          patientReference: null,
        });
        await expect(
          snapshotFor(linkedPatientIds.pendingTutorPatientId),
        ).resolves.toMatchObject({
          decision: "allowed",
          patientReference: null,
        });
        await expect(
          snapshotFor(linkedPatientIds.unlinkedPatientId),
        ).resolves.toMatchObject({
          decision: "blocked",
          patientReference: null,
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "crea una Entrega de reprogramación con consentimiento y plantilla bajo RLS",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-08-17T10:00:00.000Z");
      const appointmentStartsAt = new Date("2026-08-17T14:00:00.000Z");
      const rescheduledStartsAt = new Date("2026-08-17T14:30:00.000Z");
      try {
        const appointmentId = await inClinicTransaction(
          fixture,
          async (transaction) => {
            const doctor = await transaction.query.doctors.findFirst({
              columns: { id: true },
              where: eq(doctors.clinicId, fixture.clinicId),
            });
            if (doctor === undefined) throw new Error("Falta el Médico");
            const endsAt = new Date(
              appointmentStartsAt.valueOf() + 30 * 60_000,
            );
            const [appointment] = await transaction
              .insert(appointments)
              .values({
                authorContactId: fixture.contactId,
                bufferMinutes: 0,
                clinicId: fixture.clinicId,
                doctorId: doctor.id,
                durationMinutes: 30,
                endsAt,
                occupiedUntil: endsAt,
                origin: "reservation",
                patientId: fixture.patientId,
                serviceOfferId: fixture.offerId,
                startsAt: appointmentStartsAt,
              })
              .returning({ id: appointments.id });
            if (appointment === undefined) {
              throw new Error("No se creó la Cita de prueba");
            }
            await transaction.insert(appointmentEvents).values({
              actorContactId: fixture.contactId,
              appointmentId: appointment.id,
              clinicId: fixture.clinicId,
              type: "reservation-confirmed",
            });
            return appointment.id;
          },
        );
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            await transaction.insert(whatsappCriticalTemplates).values({
              category: "UTILITY",
              clinicId: fixture.clinicId,
              kind: "reschedule",
              locale: "es",
              name: "appointment_reschedule",
              providerTemplateId: "template-reschedule",
              provisioningStatus: "approved",
              status: "APPROVED",
              variables: [
                "patient_name",
                "clinic_name",
                "appointment_date",
                "appointment_time",
                "doctor_name",
              ],
            });
          },
        );

        await expect(
          drizzleSimulatedWhatsAppBookingStore.rescheduleAppointment({
            appointmentId,
            clinicId: fixture.clinicId,
            contactId: fixture.contactId,
            now,
            patientId: fixture.patientId,
            startsAt: rescheduledStartsAt,
          }),
        ).resolves.toMatchObject({
          kind: "rescheduled",
          startsAt: rescheduledStartsAt,
        });

        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            const [delivery] = await transaction
              .select({
                consentDecision: transactionalDeliveries.consentDecision,
                idempotencyKey: transactionalDeliveries.idempotencyKey,
                kind: transactionalDeliveries.kind,
                payload: transactionalDeliveries.payload,
                status: transactionalDeliveries.status,
              })
              .from(transactionalDeliveries)
              .where(eq(transactionalDeliveries.appointmentId, appointmentId));
            expect(delivery).toMatchObject({
              consentDecision: "allowed",
              kind: "appointment-message",
              status: "pending",
              payload: {
                patientName: "Ana",
                template: {
                  category: "UTILITY",
                  name: "appointment_reschedule",
                  parameters: [
                    "Ana",
                    "Clínica APO-18",
                    "17 de agosto de 2026",
                    "8:30 a. m.",
                    "Dra. Sol",
                  ],
                  providerTemplateId: "template-reschedule",
                  status: "APPROVED",
                },
              },
            });
            expect(delivery?.idempotencyKey).toContain(appointmentId);
          },
        );
        const [claimedReschedule] =
          await drizzleTransactionalDeliveryStore.claimReadyDeliveries({ now });
        expect(claimedReschedule).toMatchObject({
          kind: "appointment-message",
          payload: { type: "reschedule", patientName: "Ana" },
        });
        if (claimedReschedule === undefined) {
          throw new Error("No se reclamó la Entrega de reprogramación");
        }
        await drizzleTransactionalDeliveryStore.markAccepted?.({
          delivery: claimedReschedule,
          now,
          providerMessageId: "wamid-apo105-reschedule",
        });
        await drizzleTransactionalDeliveryCallbackStore.recordProviderCallback({
          providerEventId: "provider-event-apo105-delivered",
          providerMessageId: "wamid-apo105-reschedule",
          status: "delivered",
        });
        await drizzleTransactionalDeliveryCallbackStore.recordProviderCallback({
          error: "Callback atrasado fuera de orden",
          providerEventId: "provider-event-apo105-stale-failure",
          providerMessageId: "wamid-apo105-reschedule",
          status: "failed",
        });
        await expect(
          getPatientAdministrativeDetail(
            {
              clinicId: fixture.clinicId,
              identityId: fixture.identityId,
              patientId: fixture.patientId,
            },
            drizzleAdministrativeRecordsStore,
          ),
        ).resolves.toMatchObject({
          appointments: [
            {
              deliveryStatuses: [
                {
                  providerMessageId: "wamid-apo105-reschedule",
                  providerStatus: "delivered",
                  type: "reschedule",
                },
              ],
              id: appointmentId,
            },
          ],
        });
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            const events = await transaction
              .select({
                reason: appointmentEvents.reason,
                type: appointmentEvents.type,
              })
              .from(appointmentEvents)
              .where(eq(appointmentEvents.appointmentId, appointmentId));
            expect(events).toEqual(
              expect.arrayContaining([
                {
                  reason: "Reprogramación · aceptado",
                  type: "appointment-delivery-status",
                },
                {
                  reason: "Reprogramación · entregado",
                  type: "appointment-delivery-status",
                },
              ]),
            );
            expect(
              events.every((event) => !event.reason?.includes("wamid")),
            ).toBe(true);
          },
        );
        const rlsContractReason = "APO-105 RLS contract";
        await inWhatsAppOutboundWorkerTransaction(async (transaction) => {
          await transaction.insert(appointmentEvents).values(
            appointmentOutboundEventTypes.map((type) => ({
              appointmentId,
              actorContactId: fixture.contactId,
              clinicId: fixture.clinicId,
              occurredAt: now,
              reason: rlsContractReason,
              type,
            })),
          );
        });
        const outboundTypeSet = new Set<string>(appointmentOutboundEventTypes);
        const nonOutboundEventTypes = appointmentEventTypes.filter(
          (type) => !outboundTypeSet.has(type),
        );
        for (const type of nonOutboundEventTypes) {
          let rejectedEventInsert: unknown;
          try {
            await inWhatsAppOutboundWorkerTransaction(async (transaction) =>
              transaction.insert(appointmentEvents).values({
                appointmentId,
                actorContactId: fixture.contactId,
                clinicId: fixture.clinicId,
                occurredAt: now,
                reason: rlsContractReason,
                type,
              }),
            );
          } catch (error) {
            rejectedEventInsert = error;
          }
          const rejectedError = rejectedEventInsert as
            (Error & { cause?: Error }) | undefined;
          expect(
            `${rejectedError?.message ?? ""} ${rejectedError?.cause?.message ?? ""}`,
          ).toMatch(/row-level security/i);
        }
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            const events = await transaction
              .select({ type: appointmentEvents.type })
              .from(appointmentEvents)
              .where(
                and(
                  eq(appointmentEvents.appointmentId, appointmentId),
                  eq(appointmentEvents.reason, rlsContractReason),
                ),
              );
            expect(events.map(({ type }) => type).sort()).toEqual(
              [...appointmentOutboundEventTypes].sort(),
            );
          },
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

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
    "bloquea al Tutor pendiente aunque su Contacto tenga permiso y RLS rechaza nuevos permisos por Paciente",
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
              scope: "contact",
              status: "accepted",
              termsVersion: policy.termsVersion,
              textReference: policy.immutableTextReference,
            });
            return createdIdentity;
          },
        );

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
              acceptedRole: "contact",
              clinicId: fixture.clinicId,
              contactId: tutor.contactId,
              declaration: "CONTINUAR",
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
        ).rejects.toThrow();
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
        const confirmationDeliveries = await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            return transaction
              .select({
                payload: transactionalDeliveries.payload,
                status: transactionalDeliveries.status,
              })
              .from(transactionalDeliveries)
              .where(
                and(
                  eq(transactionalDeliveries.appointmentId, confirmed.id),
                  eq(transactionalDeliveries.kind, "appointment-message"),
                ),
              );
          },
        );
        expect(confirmationDeliveries).toHaveLength(1);
        expect(confirmationDeliveries[0]).toMatchObject({
          payload: { type: "confirmation" },
          status: "pending",
        });
        const [claimedConfirmation] =
          await drizzleTransactionalDeliveryStore.claimReadyDeliveries({ now });
        expect(claimedConfirmation).toMatchObject({
          kind: "appointment-message",
          payload: { type: "confirmation" },
        });
        if (claimedConfirmation === undefined) {
          throw new Error("No se reclamó la confirmación transaccional");
        }
        await drizzleTransactionalDeliveryStore.markDelivered({
          delivery: claimedConfirmation,
          now,
        });
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
            scope: "contact",
            termsVersion: policy.termsVersion,
            textReference: policy.immutableTextReference,
          });
        });
        const contactConsentReferences =
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
                  eq(whatsappContactConsents.scope, "contact"),
                ),
              );
            const adultConsent = consents.find(
              (consent) => consent.contactId === fixture.contactId,
            );
            const tutorConsent = consents.find(
              (consent) => consent.contactId === tutor.id,
            );
            if (adultConsent === undefined || tutorConsent === undefined) {
              throw new Error("Falta el consentimiento vigente por Contacto");
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
                consentReference: transactionalDeliveries.consentReference,
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
              consentReference: contactConsentReferences.adult,
              patientConsentReference: null,
              status: "processing",
            },
            {
              id: tutorDelivery.id,
              consentReference: contactConsentReferences.tutor,
              patientConsentReference: null,
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

        await expect(
          drizzleSimulatedWhatsAppBookingStore.cancelAppointment({
            appointmentId: confirmed.id,
            clinicId: fixture.clinicId,
            contactId: fixture.contactId,
            now: new Date("2026-08-17T04:00:00.000Z"),
            patientId: fixture.patientId,
          }),
        ).resolves.toMatchObject({ kind: "cancelled" });
        const cancellationDeliveries = await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
            );
            return transaction
              .select({
                payload: transactionalDeliveries.payload,
                status: transactionalDeliveries.status,
              })
              .from(transactionalDeliveries)
              .where(
                and(
                  eq(transactionalDeliveries.appointmentId, confirmed.id),
                  eq(transactionalDeliveries.kind, "appointment-message"),
                  sql`${transactionalDeliveries.payload}->>'type' = 'cancellation'`,
                ),
              );
          },
        );
        expect(cancellationDeliveries).toHaveLength(1);
        expect(cancellationDeliveries[0]).toMatchObject({
          payload: { type: "cancellation" },
          status: "pending",
        });

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
                scope: "contact",
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
    "procesa por customer y phone_number_id un mensaje v2 y lo entrega una sola vez",
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
        customerReference: `kapso-customer-${fixture.clinicId}`,
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
          { limit: 1, now },
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
    "conserva Business App, history_sync y multimedia sin despertar al asistente",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-09-22T12:00:00.000Z");
      const phoneNumberId = `kapso-origins-${fixture.clinicId}`;
      const customerId = `kapso-customer-${fixture.clinicId}`;
      const businessScopedUserId = `US.APO104.ORIGINS.${fixture.clinicId}`;
      const businessAppMessageId = `apo-104-business-app-${fixture.clinicId}`;
      const historyMessageId = `apo-104-history-${fixture.clinicId}`;
      const mediaMessageId = `apo-104-media-${fixture.clinicId}`;
      const assistantCalls: string[] = [];
      const replies: string[] = [];

      try {
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction
              .update(whatsappConnections)
              .set({
                connectionType: "coexistence",
                customer: customerId,
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
            .set({ businessScopedUserId, phoneNumberId })
            .where(
              and(
                eq(whatsappIdentities.clinicId, fixture.clinicId),
                eq(whatsappIdentities.contactId, fixture.contactId),
              ),
            );
        });

        const payload = (input: {
          direction: "inbound" | "outbound";
          id: string;
          origin: "business_app" | "cloud_api" | "history_sync";
          type: "image" | "text";
          text?: string;
        }) => {
          const outbound = input.direction === "outbound";
          return {
            conversation: {
              business_scoped_user_id: businessScopedUserId,
              id: `conversation-${fixture.contactId}`,
              phone_number: fixture.contactPhone,
              phone_number_id: phoneNumberId,
            },
            customer: { id: customerId },
            message: {
              ...(outbound
                ? {
                    from: "+50370001099",
                    from_user_id: "US.BUSINESS.APP",
                    to: fixture.contactPhone,
                    to_user_id: businessScopedUserId,
                  }
                : {
                    from: fixture.contactPhone,
                    from_user_id: businessScopedUserId,
                  }),
              ...(input.type === "image"
                ? {
                    image: {
                      id: "media-apo-104",
                      mime_type: "image/jpeg",
                      url: "https://kapso.example/should-not-be-stored",
                    },
                  }
                : { text: { body: input.text ?? "hola" } }),
              id: input.id,
              kapso: {
                direction: input.direction,
                origin: input.origin,
              },
              type: input.type,
            },
            phone_number_id: phoneNumberId,
          };
        };

        await expect(
          receiveKapsoWebhook({
            eventName: "whatsapp.message.sent",
            idempotencyKey: `${businessAppMessageId}-webhook`,
            payload: payload({
              direction: "outbound",
              id: businessAppMessageId,
              origin: "business_app",
              type: "text",
              text: "Atención humana",
            }),
            store: drizzleWhatsAppProvisioningStore,
          }),
        ).resolves.toMatchObject({ accepted: true });
        await expect(
          receiveKapsoWebhook({
            eventName: "whatsapp.message.received",
            idempotencyKey: `${historyMessageId}-webhook`,
            payload: payload({
              direction: "inbound",
              id: historyMessageId,
              origin: "history_sync",
              type: "text",
              text: "mensaje histórico",
            }),
            store: drizzleWhatsAppProvisioningStore,
          }),
        ).resolves.toMatchObject({ accepted: true });
        await expect(
          receiveKapsoWebhook({
            eventName: "whatsapp.message.received",
            idempotencyKey: `${mediaMessageId}-webhook`,
            payload: payload({
              direction: "inbound",
              id: mediaMessageId,
              origin: "cloud_api",
              type: "image",
            }),
            store: drizzleWhatsAppProvisioningStore,
          }),
        ).resolves.toMatchObject({ accepted: true });

        const result = await runKapsoInboundWorker(
          { limit: 3, now },
          drizzleWhatsAppInboundStore,
          {
            processText: async ({ messageId }) => {
              assistantCalls.push(messageId);
              return { text: "no debe responder" };
            },
          },
          createWhatsAppConsentGate(drizzleWhatsAppInboundStore),
          {
            send: async ({ text }) => {
              replies.push(text);
            },
          },
          undefined,
          {
            activate: (input) =>
              activateWhatsAppHumanTakeover(
                input,
                drizzleSimulatedWhatsAppBookingStore,
              ),
            isActive: (input) =>
              isWhatsAppHumanTakeoverActive(
                input,
                drizzleSimulatedWhatsAppBookingStore,
              ),
          },
        );

        expect(result).toMatchObject({
          claimed: 3,
          processed: 3,
          rejected: 0,
        });
        expect(assistantCalls).toEqual([]);
        expect(replies).toHaveLength(1);
        await expect(
          listConversationEscalations(
            fixture,
            drizzleConversationEscalationReader,
          ),
        ).resolves.toMatchObject([
          {
            contact: { id: fixture.contactId },
            sourceMessageType: "text",
            trigger: "business-app",
          },
        ]);

        const stored = await inSuperadminTransaction(
          fixture.superadminIdentityId,
          (transaction) =>
            transaction
              .select({
                eventName: whatsappInboundMessages.eventName,
                id: whatsappInboundMessages.messageId,
                origin: whatsappInboundMessages.origin,
                rawPayload: whatsappInboundMessages.rawPayload,
                status: whatsappInboundMessages.status,
              })
              .from(whatsappInboundMessages)
              .where(
                inArray(whatsappInboundMessages.messageId, [
                  businessAppMessageId,
                  historyMessageId,
                  mediaMessageId,
                ]),
              ),
        );
        expect(stored).toHaveLength(3);
        expect(stored).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              eventName: "whatsapp.message.sent",
              id: businessAppMessageId,
              origin: "business_app",
              status: "processed",
            }),
            expect.objectContaining({
              id: historyMessageId,
              origin: "history_sync",
              status: "processed",
            }),
            expect.objectContaining({
              id: mediaMessageId,
              origin: "cloud_api",
              status: "processed",
            }),
          ]),
        );
        const mediaPayload = stored.find(
          (message) => message.id === mediaMessageId,
        )?.rawPayload;
        expect(JSON.stringify(mediaPayload)).not.toContain(
          "should-not-be-stored",
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "activa takeover de Business App aunque la Conexión esté degradada",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-09-22T12:00:00.000Z");
      const phoneNumberId = `kapso-takeover-degraded-${fixture.clinicId}`;
      const customerId = `kapso-customer-${fixture.clinicId}`;
      const businessScopedUserId = `US.APO104.TAKEOVER.${fixture.clinicId}`;
      const messageId = `apo-104-takeover-degraded-${fixture.clinicId}`;

      try {
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction
              .update(whatsappConnections)
              .set({
                connectionType: "coexistence",
                customer: customerId,
                phoneNumberId,
                provider: "kapso",
                status: "degraded",
              })
              .where(eq(whatsappConnections.clinicId, fixture.clinicId));
            await transaction
              .update(clinics)
              .set({
                escalationNotificationsEnabled: true,
                escalationSecretaryPhoneE164: "+50370000009",
              })
              .where(eq(clinics.id, fixture.clinicId));
          },
        );
        await expect(
          inSuperadminTransaction(fixture.superadminIdentityId, (transaction) =>
            transaction
              .select({
                enabled: clinics.escalationNotificationsEnabled,
                phone: clinics.escalationSecretaryPhoneE164,
              })
              .from(clinics)
              .where(eq(clinics.id, fixture.clinicId)),
          ),
        ).resolves.toEqual([{ enabled: true, phone: "+50370000009" }]);
        await inWhatsAppInboundWorkerTransaction(async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
          );
          await transaction
            .update(whatsappIdentities)
            .set({ businessScopedUserId, phoneNumberId })
            .where(
              and(
                eq(whatsappIdentities.clinicId, fixture.clinicId),
                eq(whatsappIdentities.contactId, fixture.contactId),
              ),
            );
        });

        await expect(
          receiveKapsoWebhook({
            eventName: "whatsapp.message.sent",
            idempotencyKey: `${messageId}-webhook`,
            payload: {
              conversation: {
                business_scoped_user_id: businessScopedUserId,
                id: `conversation-${fixture.contactId}`,
                phone_number: fixture.contactPhone,
                phone_number_id: phoneNumberId,
              },
              customer: { id: customerId },
              message: {
                from: "+50370001099",
                from_user_id: "US.BUSINESS.APP",
                id: messageId,
                kapso: { direction: "outbound", origin: "business_app" },
                text: { body: "Atención humana" },
                to: fixture.contactPhone,
                to_user_id: businessScopedUserId,
                type: "text",
              },
              phone_number_id: phoneNumberId,
            },
            store: drizzleWhatsAppProvisioningStore,
          }),
        ).resolves.toMatchObject({ accepted: true });

        const inboundReplySender = createKapsoInboundReplySender();
        const takeoverStore = {
          getConversation: (input: { clinicId: string; contactId: string }) =>
            drizzleSimulatedWhatsAppBookingStore.getConversation(input),
          openHumanTakeover: (
            input: Parameters<
              typeof drizzleSimulatedWhatsAppBookingStore.openHumanTakeover
            >[0],
          ) => drizzleSimulatedWhatsAppBookingStore.openHumanTakeover(input),
          notifySecretaryOfConversationEscalation: (input: {
            clinicId: string;
            escalationId: string;
            recipientPhoneE164: string;
          }) =>
            inboundReplySender.send({
              clinicId: input.clinicId,
              idempotencyKey: `escalation:${input.escalationId}`,
              recipientBusinessScopedUserId: null,
              recipientPhoneE164: input.recipientPhoneE164,
              text: "La Clínica recibió tu solicitud y una persona te contactará pronto.",
            }),
        };
        await expect(
          runKapsoInboundWorker(
            { limit: 1, now },
            drizzleWhatsAppInboundStore,
            {
              processText: async () => ({ text: "no debe responder" }),
            },
            createWhatsAppConsentGate(drizzleWhatsAppInboundStore),
            inboundReplySender,
            undefined,
            {
              activate: (input) =>
                activateWhatsAppHumanTakeover(input, takeoverStore),
              isActive: (input) =>
                isWhatsAppHumanTakeoverActive(input, takeoverStore),
            },
          ),
        ).resolves.toMatchObject({
          claimed: 1,
          processed: 1,
          retried: 0,
          rejected: 0,
        });
        await expect(
          inSuperadminTransaction(fixture.superadminIdentityId, (transaction) =>
            transaction
              .select({
                recipientPhoneE164: whatsappInboundReplies.recipientPhoneE164,
                status: whatsappInboundReplies.status,
              })
              .from(whatsappInboundReplies)
              .where(
                and(
                  eq(whatsappInboundReplies.recipientPhoneE164, "+50370000009"),
                  eq(whatsappInboundReplies.clinicId, fixture.clinicId),
                ),
              ),
          ),
        ).resolves.toEqual([
          {
            recipientPhoneE164: "+50370000009",
            status: "pending",
          },
        ]);
        await expect(
          listConversationEscalations(
            fixture,
            drizzleConversationEscalationReader,
          ),
        ).resolves.toMatchObject([
          {
            contact: { id: fixture.contactId },
            trigger: "business-app",
          },
        ]);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "procesa un lote Kapso fuera de orden sin duplicar efectos",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-09-22T12:00:00.000Z");
      const phoneNumberId = `kapso-ordering-${fixture.clinicId}`;
      const conversationId = `conversation-ordering-${fixture.clinicId}`;
      const customerId = `kapso-customer-${fixture.clinicId}`;
      const businessScopedUserId = `US.APO104.ORDERING.${fixture.clinicId}`;
      const firstSequence = 501;
      const assistantCalls: string[] = [];
      const replies: string[] = [];
      const makeMessage = (sequence: number): WhatsAppInboundMessage => ({
        batchFirstSequence: firstSequence,
        batchSequence: sequence,
        businessScopedUserId,
        conversationId,
        customerReference: customerId,
        direction: "inbound",
        eventName: "whatsapp.message.received",
        fromWaId: fixture.contactPhone,
        id: `${phoneNumberId}-${sequence}`,
        interactiveAction: null,
        messageTimestamp: now,
        origin: "api",
        parentBusinessScopedUserId: null,
        phoneE164: fixture.contactPhone,
        connectionReference: phoneNumberId,
        rawPayload: { message: { id: `${phoneNumberId}-${sequence}` } },
        text: "info",
        type: "text",
        username: null,
      });

      try {
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction
              .update(whatsappConnections)
              .set({
                connectionType: "coexistence",
                customer: customerId,
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
            .set({
              businessScopedUserId,
              phoneE164: fixture.contactPhone,
              phoneNumberId,
            })
            .where(
              and(
                eq(whatsappIdentities.clinicId, fixture.clinicId),
                eq(whatsappIdentities.contactId, fixture.contactId),
              ),
            );
        });

        await expect(
          drizzleWhatsAppInboundStore.enqueueInbound({
            idempotencyKey: `${phoneNumberId}-502`,
            message: makeMessage(502),
          }),
        ).resolves.toMatchObject({ accepted: true });

        await expect(
          drizzleWhatsAppInboundStore.enqueueInbound({
            idempotencyKey: `${phoneNumberId}-501`,
            message: makeMessage(501),
          }),
        ).resolves.toMatchObject({ accepted: true });

        await expect(
          runKapsoInboundWorker(
            { limit: 2, now },
            drizzleWhatsAppInboundStore,
            {
              processText: async ({ messageId }) => {
                assistantCalls.push(messageId);
                return { text: `respuesta-${messageId}` };
              },
            },
            createWhatsAppConsentGate(drizzleWhatsAppInboundStore),
            {
              send: async ({ text }) => {
                replies.push(text);
              },
            },
            undefined,
            { activate: async () => undefined, isActive: async () => false },
          ),
        ).resolves.toMatchObject({ claimed: 2, processed: 2 });
        expect(assistantCalls).toEqual([
          `${phoneNumberId}-501`,
          `${phoneNumberId}-502`,
        ]);
        expect(replies).toEqual([
          `respuesta-${phoneNumberId}-501`,
          `respuesta-${phoneNumberId}-502`,
        ]);

        await expect(
          drizzleWhatsAppInboundStore.enqueueInbound({
            idempotencyKey: `${phoneNumberId}-502-replay`,
            message: makeMessage(502),
          }),
        ).resolves.toMatchObject({ accepted: false });
        await expect(
          runKapsoInboundWorker(
            { limit: 2, now: new Date(now.valueOf() + 1_000) },
            drizzleWhatsAppInboundStore,
            {
              processText: async ({ messageId }) => {
                assistantCalls.push(messageId);
                return { text: `respuesta-${messageId}` };
              },
            },
            createWhatsAppConsentGate(drizzleWhatsAppInboundStore),
            {
              send: async ({ text }) => {
                replies.push(text);
              },
            },
            undefined,
            { activate: async () => undefined, isActive: async () => false },
          ),
        ).resolves.toMatchObject({ claimed: 0, processed: 0 });
        expect(assistantCalls).toHaveLength(2);
        expect(replies).toHaveLength(2);
      } finally {
        await fixture.cleanup();
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

        const alertsBeforeResolution =
          await listWhatsAppInboundOperationalAlerts({
            identityId: fixture.superadminIdentityId,
          });
        const alert = alertsBeforeResolution.find(
          (candidate) =>
            candidate.connectionReference === message.connectionReference &&
            candidate.customerReference === message.customerReference,
        );
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
        ).resolves.not.toContainEqual(
          expect.objectContaining({ id: alert.id }),
        );
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

  databaseTest(
    "conserva cambios de Identidad de WhatsApp y no repite efectos al reentregar el mismo mensaje",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-09-22T12:00:00.000Z");
      const phoneNumberId = `kapso-identity-${fixture.clinicId}`;
      const customerId = `kapso-customer-${fixture.clinicId}`;
      const businessScopedUserId = `US.APO104.${fixture.clinicId}`;
      const changedBusinessScopedUserId = `US.APO104.CHANGED.${fixture.clinicId}`;
      const newContactBusinessScopedUserId = `US.APO104.NEW.${fixture.clinicId}`;
      const firstMessageId = `apo-104-identity-first-${fixture.clinicId}`;
      const secondMessageId = `apo-104-identity-second-${fixture.clinicId}`;
      const newContactMessageId = `apo-104-identity-new-${fixture.clinicId}`;
      const secondPhone = "+50370001042";
      const assistantCalls: string[] = [];
      const replies: string[] = [];

      try {
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction
              .update(whatsappConnections)
              .set({
                connectionType: "coexistence",
                customer: customerId,
                phoneNumberId,
                provider: "kapso",
                status: "ready",
              })
              .where(eq(whatsappConnections.clinicId, fixture.clinicId));
          },
        );
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction
              .update(contacts)
              .set({ phoneE164: null })
              .where(
                and(
                  eq(contacts.clinicId, fixture.clinicId),
                  eq(contacts.id, fixture.contactId),
                ),
              );
            await transaction
              .update(whatsappIdentities)
              .set({
                businessScopedUserId,
                phoneE164: null,
                phoneNumberId,
              })
              .where(
                and(
                  eq(whatsappIdentities.clinicId, fixture.clinicId),
                  eq(whatsappIdentities.contactId, fixture.contactId),
                ),
              );
          },
        );

        const createPayload = (input: {
          businessScopedUserId: string;
          id: string;
          phoneE164: string | null;
        }) => ({
          conversation: {
            business_scoped_user_id: input.businessScopedUserId,
            id: `conversation-${fixture.contactId}`,
            phone_number: input.phoneE164,
            phone_number_id: phoneNumberId,
          },
          customer: { id: customerId },
          message: {
            from: input.phoneE164 ?? input.businessScopedUserId,
            from_user_id: input.businessScopedUserId,
            id: input.id,
            kapso: { direction: "inbound", origin: "cloud_api" },
            text: { body: "info" },
            type: "text",
          },
          phone_number_id: phoneNumberId,
        });
        const firstPayload = createPayload({
          businessScopedUserId,
          id: firstMessageId,
          phoneE164: null,
        });

        await expect(
          receiveKapsoWebhook({
            eventName: "whatsapp.message.received",
            idempotencyKey: `apo-104-first-${fixture.clinicId}`,
            payload: firstPayload,
            store: drizzleWhatsAppProvisioningStore,
          }),
        ).resolves.toMatchObject({ accepted: true });
        await expect(
          runKapsoInboundWorker(
            { now },
            drizzleWhatsAppInboundStore,
            {
              processText: async ({ messageId }) => {
                assistantCalls.push(messageId);
                return { text: `respuesta-${messageId}` };
              },
            },
            createWhatsAppConsentGate(drizzleWhatsAppInboundStore),
            {
              send: async ({ text }) => {
                replies.push(text);
              },
            },
            undefined,
            { activate: async () => undefined, isActive: async () => false },
          ),
        ).resolves.toMatchObject({ processed: 1 });

        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction
              .update(contacts)
              .set({ phoneE164: secondPhone })
              .where(
                and(
                  eq(contacts.clinicId, fixture.clinicId),
                  eq(contacts.id, fixture.contactId),
                ),
              );
          },
        );

        const secondPayload = createPayload({
          businessScopedUserId: changedBusinessScopedUserId,
          id: secondMessageId,
          phoneE164: secondPhone,
        });

        await expect(
          receiveKapsoWebhook({
            eventName: "whatsapp.message.received",
            idempotencyKey: `apo-104-second-${fixture.clinicId}`,
            payload: secondPayload,
            store: drizzleWhatsAppProvisioningStore,
          }),
        ).resolves.toMatchObject({ accepted: true });
        await expect(
          runKapsoInboundWorker(
            { now },
            drizzleWhatsAppInboundStore,
            {
              processText: async ({ messageId }) => {
                assistantCalls.push(messageId);
                return { text: `respuesta-${messageId}` };
              },
            },
            createWhatsAppConsentGate(drizzleWhatsAppInboundStore),
            {
              send: async ({ text }) => {
                replies.push(text);
              },
            },
            undefined,
            { activate: async () => undefined, isActive: async () => false },
          ),
        ).resolves.toMatchObject({ processed: 1 });

        const newContactPayload = createPayload({
          businessScopedUserId: newContactBusinessScopedUserId,
          id: newContactMessageId,
          phoneE164: null,
        });
        await expect(
          receiveKapsoWebhook({
            eventName: "whatsapp.message.received",
            idempotencyKey: `apo-104-new-${fixture.clinicId}`,
            payload: newContactPayload,
            store: drizzleWhatsAppProvisioningStore,
          }),
        ).resolves.toMatchObject({ accepted: true });
        await expect(
          runKapsoInboundWorker(
            { now },
            drizzleWhatsAppInboundStore,
            {
              processText: async ({ messageId }) => {
                assistantCalls.push(messageId);
                return { text: `respuesta-${messageId}` };
              },
            },
            createWhatsAppConsentGate(drizzleWhatsAppInboundStore),
            {
              send: async ({ text }) => {
                replies.push(text);
              },
            },
            undefined,
            { activate: async () => undefined, isActive: async () => false },
          ),
        ).resolves.toMatchObject({
          awaitingConsent: 1,
          claimed: 1,
          processed: 0,
        });
        expect(assistantCalls).toEqual([firstMessageId, secondMessageId]);
        expect(replies).toHaveLength(3);

        const newInbound = await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) =>
            transaction
              .select({
                contactId: whatsappInboundMessages.contactId,
                identityId: whatsappInboundMessages.identityId,
                status: whatsappInboundMessages.status,
              })
              .from(whatsappInboundMessages)
              .where(
                eq(whatsappInboundMessages.messageId, newContactMessageId),
              ),
        );
        const newContactId = newInbound[0]?.contactId;
        if (newContactId === null || newContactId === undefined) {
          throw new Error("El inbound BSUID no creó un Contacto");
        }
        expect(newInbound[0]).toMatchObject({ status: "awaiting-consent" });
        await expect(
          inSuperadminTransaction(fixture.superadminIdentityId, (transaction) =>
            transaction
              .select({
                name: contacts.name,
                phoneE164: contacts.phoneE164,
              })
              .from(contacts)
              .where(eq(contacts.id, newContactId)),
          ),
        ).resolves.toEqual([{ name: "Contacto de WhatsApp", phoneE164: null }]);

        const replay = await receiveKapsoWebhook({
          eventName: "whatsapp.message.received",
          idempotencyKey: `apo-104-replay-${fixture.clinicId}`,
          payload: firstPayload,
          store: drizzleWhatsAppProvisioningStore,
        });
        expect(replay.accepted).toBe(false);
        expect(replay.eventId).toBeTypeOf("string");
        await expect(
          drizzleWhatsAppInboundStore.claimDueMessages({ now, limit: 20 }),
        ).resolves.toEqual([]);

        expect(assistantCalls).toEqual([firstMessageId, secondMessageId]);
        expect(replies.slice(0, 2)).toEqual([
          `respuesta-${firstMessageId}`,
          `respuesta-${secondMessageId}`,
        ]);

        const identities = await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) =>
            transaction
              .select({
                businessScopedUserId: whatsappIdentities.businessScopedUserId,
                phoneE164: whatsappIdentities.phoneE164,
                sourceMessageId: whatsappIdentities.sourceMessageId,
                status: whatsappIdentities.status,
              })
              .from(whatsappIdentities)
              .where(
                and(
                  eq(whatsappIdentities.clinicId, fixture.clinicId),
                  eq(whatsappIdentities.contactId, fixture.contactId),
                ),
              ),
        );
        expect(identities).toHaveLength(2);
        expect(identities).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              businessScopedUserId,
              phoneE164: null,
              status: "historical",
            }),
            expect.objectContaining({
              businessScopedUserId: changedBusinessScopedUserId,
              phoneE164: secondPhone,
              sourceMessageId: secondMessageId,
              status: "active",
            }),
          ]),
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "conserva identidades activas no relacionadas durante un rollover",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-09-22T12:00:00.000Z");
      const phoneNumberId = `kapso-multiple-identities-${fixture.clinicId}`;
      const customerId = `kapso-customer-${fixture.clinicId}`;
      const oldBusinessScopedUserId = `US.APO104.OLD.${fixture.clinicId}`;
      const nextBusinessScopedUserId = `US.APO104.NEXT.${fixture.clinicId}`;
      const unrelatedBusinessScopedUserId = `US.APO104.UNRELATED.${fixture.clinicId}`;
      const unrelatedPhone = "+50370001046";
      const messageId = `apo-104-multiple-identities-${fixture.clinicId}`;

      try {
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction
              .update(whatsappConnections)
              .set({
                connectionType: "coexistence",
                customer: customerId,
                phoneNumberId,
                provider: "kapso",
                status: "ready",
              })
              .where(eq(whatsappConnections.clinicId, fixture.clinicId));
            await transaction
              .update(contacts)
              .set({ phoneE164: fixture.contactPhone })
              .where(
                and(
                  eq(contacts.clinicId, fixture.clinicId),
                  eq(contacts.id, fixture.contactId),
                ),
              );
          },
        );
        await inWhatsAppInboundWorkerTransaction(async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
          );
          await transaction
            .update(whatsappIdentities)
            .set({
              businessScopedUserId: oldBusinessScopedUserId,
              phoneE164: fixture.contactPhone,
              phoneNumberId,
            })
            .where(
              and(
                eq(whatsappIdentities.clinicId, fixture.clinicId),
                eq(whatsappIdentities.contactId, fixture.contactId),
              ),
            );
          await transaction.insert(whatsappIdentities).values({
            businessScopedUserId: unrelatedBusinessScopedUserId,
            clinicId: fixture.clinicId,
            contactId: fixture.contactId,
            phoneE164: unrelatedPhone,
            phoneNumberId,
            status: "active",
          });
        });

        await expect(
          receiveKapsoWebhook({
            eventName: "whatsapp.message.received",
            idempotencyKey: `apo-104-multiple-identities-key-${fixture.clinicId}`,
            payload: {
              conversation: {
                business_scoped_user_id: nextBusinessScopedUserId,
                id: `conversation-${fixture.contactId}`,
                phone_number: fixture.contactPhone,
                phone_number_id: phoneNumberId,
              },
              customer: { id: customerId },
              message: {
                from: fixture.contactPhone,
                from_user_id: nextBusinessScopedUserId,
                id: messageId,
                kapso: { direction: "inbound", origin: "cloud_api" },
                text: { body: "info" },
                type: "text",
              },
              phone_number_id: phoneNumberId,
            },
            store: drizzleWhatsAppProvisioningStore,
          }),
        ).resolves.toMatchObject({ accepted: true });
        await expect(
          runKapsoInboundWorker(
            { now },
            drizzleWhatsAppInboundStore,
            { processText: async () => ({ text: "Respuesta." }) },
            createWhatsAppConsentGate(drizzleWhatsAppInboundStore),
            { send: async () => undefined },
            undefined,
            { activate: async () => undefined, isActive: async () => false },
          ),
        ).resolves.toMatchObject({ processed: 1 });

        await expect(
          inSuperadminTransaction(
            fixture.superadminIdentityId,
            async (transaction) =>
              transaction
                .select({
                  businessScopedUserId: whatsappIdentities.businessScopedUserId,
                  phoneE164: whatsappIdentities.phoneE164,
                  status: whatsappIdentities.status,
                })
                .from(whatsappIdentities)
                .where(
                  and(
                    eq(whatsappIdentities.clinicId, fixture.clinicId),
                    eq(whatsappIdentities.contactId, fixture.contactId),
                    eq(whatsappIdentities.phoneNumberId, phoneNumberId),
                  ),
                ),
          ),
        ).resolves.toEqual(
          expect.arrayContaining([
            {
              businessScopedUserId: oldBusinessScopedUserId,
              phoneE164: fixture.contactPhone,
              status: "historical",
            },
            {
              businessScopedUserId: unrelatedBusinessScopedUserId,
              phoneE164: unrelatedPhone,
              status: "active",
            },
            {
              businessScopedUserId: nextBusinessScopedUserId,
              phoneE164: fixture.contactPhone,
              status: "active",
            },
          ]),
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "retira ambos snapshots cuando BSUID y teléfono cruzan identidades del mismo Contacto",
    async () => {
      const fixture = await createFixture();
      const now = new Date("2026-09-22T12:00:00.000Z");
      const phoneNumberId = `kapso-overlap-${fixture.clinicId}`;
      const customerId = `kapso-customer-${fixture.clinicId}`;
      const firstBusinessScopedUserId = `US.APO104.OVERLAP.FIRST.${fixture.clinicId}`;
      const secondBusinessScopedUserId = `US.APO104.OVERLAP.SECOND.${fixture.clinicId}`;
      const firstPhone = "+50370001047";
      const secondPhone = "+50370001048";
      const messageId = `apo-104-overlap-${fixture.clinicId}`;

      try {
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction
              .update(whatsappConnections)
              .set({
                connectionType: "coexistence",
                customer: customerId,
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
            .set({
              businessScopedUserId: firstBusinessScopedUserId,
              phoneE164: firstPhone,
              phoneNumberId,
            })
            .where(
              and(
                eq(whatsappIdentities.clinicId, fixture.clinicId),
                eq(whatsappIdentities.contactId, fixture.contactId),
              ),
            );
          await transaction.insert(whatsappIdentities).values({
            businessScopedUserId: secondBusinessScopedUserId,
            clinicId: fixture.clinicId,
            contactId: fixture.contactId,
            phoneE164: secondPhone,
            phoneNumberId,
            status: "active",
          });
        });

        await expect(
          receiveKapsoWebhook({
            eventName: "whatsapp.message.received",
            idempotencyKey: `apo-104-overlap-key-${fixture.clinicId}`,
            payload: {
              conversation: {
                business_scoped_user_id: secondBusinessScopedUserId,
                id: `conversation-${fixture.contactId}`,
                phone_number: firstPhone,
                phone_number_id: phoneNumberId,
              },
              customer: { id: customerId },
              message: {
                from: firstPhone,
                from_user_id: secondBusinessScopedUserId,
                id: messageId,
                kapso: { direction: "inbound", origin: "cloud_api" },
                text: { body: "info" },
                type: "text",
              },
              phone_number_id: phoneNumberId,
            },
            store: drizzleWhatsAppProvisioningStore,
          }),
        ).resolves.toMatchObject({ accepted: true });
        await expect(
          runKapsoInboundWorker(
            { now },
            drizzleWhatsAppInboundStore,
            { processText: async () => ({ text: "Respuesta." }) },
            createWhatsAppConsentGate(drizzleWhatsAppInboundStore),
            { send: async () => undefined },
            undefined,
            { activate: async () => undefined, isActive: async () => false },
          ),
        ).resolves.toMatchObject({ processed: 1 });

        await expect(
          inSuperadminTransaction(
            fixture.superadminIdentityId,
            async (transaction) =>
              transaction
                .select({
                  businessScopedUserId: whatsappIdentities.businessScopedUserId,
                  phoneE164: whatsappIdentities.phoneE164,
                  status: whatsappIdentities.status,
                })
                .from(whatsappIdentities)
                .where(
                  and(
                    eq(whatsappIdentities.clinicId, fixture.clinicId),
                    eq(whatsappIdentities.contactId, fixture.contactId),
                    eq(whatsappIdentities.phoneNumberId, phoneNumberId),
                  ),
                ),
          ),
        ).resolves.toEqual(
          expect.arrayContaining([
            {
              businessScopedUserId: firstBusinessScopedUserId,
              phoneE164: firstPhone,
              status: "historical",
            },
            {
              businessScopedUserId: secondBusinessScopedUserId,
              phoneE164: secondPhone,
              status: "historical",
            },
            {
              businessScopedUserId: secondBusinessScopedUserId,
              phoneE164: firstPhone,
              status: "active",
            },
          ]),
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  databaseTest(
    "resuelve el mismo BSUID dentro de su phone_number_id y conserva el aislamiento entre Clínicas",
    async () => {
      const fixture = await createFixture();
      const primaryPhoneNumberId = `kapso-isolation-primary-${fixture.clinicId}`;
      const otherPhoneNumberId = `kapso-isolation-other-${fixture.other.clinicId}`;
      const sharedBusinessScopedUserId = `US.APO104.ISOLATION.${fixture.clinicId}`;
      const sharedPhone = "+50370001043";
      let otherContactId: string | undefined;
      const assistantCalls: string[] = [];

      try {
        await inSuperadminTransaction(
          fixture.superadminIdentityId,
          async (transaction) => {
            await transaction
              .update(whatsappConnections)
              .set({
                connectionType: "coexistence",
                customer: `kapso-primary-${fixture.clinicId}`,
                phoneNumberId: primaryPhoneNumberId,
                provider: "kapso",
                status: "ready",
              })
              .where(eq(whatsappConnections.clinicId, fixture.clinicId));
            await transaction
              .update(whatsappConnections)
              .set({
                connectionType: "coexistence",
                customer: `kapso-other-${fixture.other.clinicId}`,
                phoneNumberId: otherPhoneNumberId,
                provider: "kapso",
                status: "ready",
              })
              .where(eq(whatsappConnections.clinicId, fixture.other.clinicId));
            await transaction.execute(
              sql`select set_config('app.clinic_id', ${fixture.other.clinicId}, true)`,
            );
            const [contact] = await transaction
              .insert(contacts)
              .values({
                clinicId: fixture.other.clinicId,
                name: "Contacto aislado APO-104",
                phoneE164: sharedPhone,
              })
              .returning({ id: contacts.id });
            otherContactId = contact?.id;
          },
        );
        if (otherContactId === undefined) {
          throw new Error("No se creó el Contacto aislado");
        }

        await inWhatsAppInboundWorkerTransaction(async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${fixture.clinicId}, true)`,
          );
          await transaction
            .update(whatsappIdentities)
            .set({
              businessScopedUserId: sharedBusinessScopedUserId,
              phoneE164: sharedPhone,
              phoneNumberId: primaryPhoneNumberId,
            })
            .where(
              and(
                eq(whatsappIdentities.clinicId, fixture.clinicId),
                eq(whatsappIdentities.contactId, fixture.contactId),
              ),
            );
          await transaction.execute(
            sql`select set_config('app.clinic_id', ${fixture.other.clinicId}, true)`,
          );
          await transaction.insert(whatsappIdentities).values({
            businessScopedUserId: sharedBusinessScopedUserId,
            clinicId: fixture.other.clinicId,
            contactId: otherContactId,
            phoneE164: sharedPhone,
            phoneNumberId: otherPhoneNumberId,
            status: "active",
          });
        });

        const messageId = `apo-104-isolation-${fixture.clinicId}`;
        await expect(
          drizzleWhatsAppInboundStore.enqueueInbound({
            idempotencyKey: `apo-104-isolation-key-${fixture.clinicId}`,
            message: {
              batchFirstSequence: null,
              batchSequence: null,
              businessScopedUserId: sharedBusinessScopedUserId,
              connectionReference: primaryPhoneNumberId,
              conversationId: "apo-104-isolation-conversation",
              customerReference: `kapso-primary-${fixture.clinicId}`,
              direction: "inbound",
              eventName: "whatsapp.message.received",
              fromWaId: sharedPhone,
              id: messageId,
              interactiveAction: null,
              messageTimestamp: new Date("2026-09-22T12:00:00.000Z"),
              origin: "api",
              parentBusinessScopedUserId: null,
              phoneE164: sharedPhone,
              rawPayload: { message: { id: messageId } },
              text: "info",
              type: "text",
              username: null,
            },
          }),
        ).resolves.toMatchObject({ accepted: true });

        await expect(
          runKapsoInboundWorker(
            { now: new Date("2026-09-22T12:01:00.000Z") },
            drizzleWhatsAppInboundStore,
            {
              processText: async ({ messageId: processedMessageId }) => {
                assistantCalls.push(processedMessageId);
                return { text: "Respuesta aislada." };
              },
            },
            createWhatsAppConsentGate(drizzleWhatsAppInboundStore),
            { send: async () => undefined },
            undefined,
            { activate: async () => undefined, isActive: async () => false },
          ),
        ).resolves.toMatchObject({ processed: 1 });

        await expect(
          inSuperadminTransaction(
            fixture.superadminIdentityId,
            async (transaction) =>
              transaction
                .select({
                  clinicId: whatsappInboundMessages.clinicId,
                  contactId: whatsappInboundMessages.contactId,
                })
                .from(whatsappInboundMessages)
                .where(eq(whatsappInboundMessages.messageId, messageId)),
          ),
        ).resolves.toEqual([
          {
            clinicId: fixture.clinicId,
            contactId: fixture.contactId,
          },
        ]);
        await expect(
          inClinicTransaction(fixture, (transaction) =>
            transaction
              .select({ contactId: whatsappIdentities.contactId })
              .from(whatsappIdentities),
          ),
        ).resolves.toEqual([
          { contactId: fixture.contactId },
          { contactId: fixture.contactId },
        ]);
        await expect(
          inClinicTransaction(fixture.other, (transaction) =>
            transaction
              .select({ contactId: whatsappIdentities.contactId })
              .from(whatsappIdentities),
          ),
        ).resolves.toEqual([{ contactId: otherContactId }]);

        const mismatchedMessageId = `apo-104-customer-mismatch-${fixture.clinicId}`;
        await expect(
          receiveKapsoWebhook({
            eventName: "whatsapp.message.received",
            idempotencyKey: `apo-104-customer-mismatch-key-${fixture.clinicId}`,
            payload: {
              conversation: {
                business_scoped_user_id: sharedBusinessScopedUserId,
                id: "apo-104-customer-mismatch-conversation",
                phone_number: sharedPhone,
                phone_number_id: primaryPhoneNumberId,
              },
              customer: { id: "kapso-wrong-customer" },
              message: {
                from: sharedPhone,
                from_user_id: sharedBusinessScopedUserId,
                id: mismatchedMessageId,
                kapso: { direction: "inbound", origin: "cloud_api" },
                text: { body: "no debe cruzar" },
                type: "text",
              },
              phone_number_id: primaryPhoneNumberId,
            },
            store: drizzleWhatsAppProvisioningStore,
          }),
        ).resolves.toMatchObject({ accepted: true });
        await expect(
          runKapsoInboundWorker(
            { now: new Date("2026-09-22T12:02:00.000Z") },
            drizzleWhatsAppInboundStore,
            {
              processText: async ({ messageId: rejectedMessageId }) => {
                assistantCalls.push(rejectedMessageId);
                return { text: "no debe responder" };
              },
            },
            createWhatsAppConsentGate(drizzleWhatsAppInboundStore),
            { send: async () => undefined },
            undefined,
            { activate: async () => undefined, isActive: async () => false },
          ),
        ).resolves.toMatchObject({
          claimed: 1,
          processed: 0,
          rejected: 1,
        });
        expect(assistantCalls).toEqual([messageId]);
        const rejected = await inSuperadminTransaction(
          fixture.superadminIdentityId,
          (transaction) =>
            transaction
              .select({ id: whatsappInboundMessages.id })
              .from(whatsappInboundMessages)
              .where(
                eq(whatsappInboundMessages.messageId, mismatchedMessageId),
              ),
        );
        expect(rejected).toHaveLength(1);
        const alerts = await listWhatsAppInboundOperationalAlerts({
          identityId: fixture.superadminIdentityId,
        });
        expect(alerts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              customerReference: "kapso-wrong-customer",
              inboundMessageId: rejected[0]?.id,
            }),
          ]),
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
      scope: "contact",
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
            .delete(whatsappInboundMessages)
            .where(
              inArray(whatsappInboundMessages.clinicId, [
                primary.clinicId,
                other.clinicId,
              ]),
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
