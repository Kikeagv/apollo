import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { env } from "~/env";
import { filterPanaceaConfigurationOverview } from "~/domain/panacea-configuration";
import { acceptClinicInvitation } from "~/server/application/accept-clinic-owner-invitation";
import { getPanaceaConfigurationOverview } from "~/server/application/panacea-configuration";
import { listPanaceaTeam } from "~/server/application/panacea-team";
import { inviteAdditionalDoctor } from "~/server/application/doctor-invitations";
import { completeOwnDoctorProfile } from "~/server/application/doctor-profile";
import {
  deactivateDoctor,
  DoctorDeactivationAccessError,
} from "~/server/application/doctor-status";
import { createSyntheticClinic } from "~/server/application/create-synthetic-clinic";
import {
  listAppointmentSelfManagementEscalations,
  resolveAppointmentSelfManagementEscalation,
} from "~/server/application/appointment-self-management";
import {
  getEscalationNotificationSettings,
  listConversationEscalations,
  resolveConversationEscalation,
  setEscalationNotificationSettings,
} from "~/server/application/conversation-escalations";
import {
  getVoiceTranscriptionSettings,
  setVoiceTranscriptionSettings,
} from "~/server/application/voice-note-transcription-settings";
import {
  listPendingCases,
  resolvePendingCase,
} from "~/server/application/pending";
import { performSyntheticClinicalAction } from "~/server/application/perform-synthetic-clinical-action";
import { canAccessPanaceaTechnicalSurface } from "~/server/application/panacea-technical-surface";
import {
  configureEffectiveSchedule,
  createAvailabilityBlock,
  createAvailabilityBlocks,
} from "~/server/application/availability";
import { calculateCareOptions } from "~/server/application/care-options";
import {
  cancelManualAppointment,
  createManualAppointment,
  listPanaceaCalendar,
  listPanaceaCalendarDoctors,
  listCancelledManualAppointments,
  listManualAppointmentFormData,
  listManualAppointments,
} from "~/server/application/manual-appointments";
import {
  addPatientContact,
  createContact,
  createContactPatientLink,
  createIncompletePatient,
  createPatient,
  findContactByPhone,
  getPatientAdministrativeDetail,
  listAdministrativeRecords,
  listPatientDirectory,
  listPendingGuardianshipVerifications,
  registerPatient,
  registerAdministrativeRecordsForManualAppointment,
  updateContact,
  updatePatient,
  verifyPatientGuardianship,
} from "~/server/application/administrative-records";
import {
  addServiceOffer,
  createService,
  deactivateServiceOffer,
  ServiceCatalogAccessError,
  updateService,
  updateServiceOffer,
} from "~/server/application/service-catalog";
import { drizzleSyntheticClinicRegistration } from "~/server/db/synthetic-clinic-registration";
import { listVisibleClinicSupportSessions } from "~/server/db/subscription-support-store";
import {
  drizzleAvailabilityStore,
  drizzleCareOptionsStore,
  listAvailabilityConfiguration,
} from "~/server/db/availability-store";
import {
  listDoctorInvitationStatuses,
  drizzleDoctorInvitationStore,
} from "~/server/db/doctor-invitation-store";
import { drizzlePanaceaConfigurationReader } from "~/server/db/panacea-configuration-store";
import { drizzlePanaceaTeamReader } from "~/server/db/panacea-team-store";
import {
  drizzleDoctorStatusStore,
  listDoctors,
} from "~/server/db/doctor-status-store";
import {
  drizzleServiceCatalogStore,
  listServiceCatalog,
} from "~/server/db/service-catalog-store";
import { drizzleAdministrativeRecordsStore } from "~/server/db/administrative-records-store";
import { drizzleManualAppointmentStore } from "~/server/db/manual-appointment-store";
import {
  drizzleAppointmentSelfManagementEscalationReader,
  drizzleAppointmentSelfManagementEscalationResolver,
  drizzleConversationEscalationReader,
  drizzleConversationEscalationResolver,
  drizzleEscalationNotificationSettingsStore,
  drizzleVoiceTranscriptionSettingsStore,
} from "~/server/db/simulated-whatsapp-booking-store";
import { clinicInvitationEmailSender } from "~/server/email/clinic-invitation-email";
import { whatsAppSender } from "~/server/whatsapp/whatsapp-delivery";
import {
  getNoShowPolicy,
  setNoShowPolicy,
} from "~/server/application/no-show-policy";
import { drizzleNoShowPolicyStore } from "~/server/db/no-show-policy-store";
import {
  listTransactionalDeliveryAlerts,
  resolveTransactionalDeliveryAlert,
} from "~/server/db/transactional-delivery-store";
import {
  drizzlePendingResolver,
  drizzlePendingStore,
} from "~/server/db/pending-store";
import {
  clinicProcedure,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";

const patientContactInput = z.discriminatedUnion("kind", [
  z.object({
    contactId: z.string().uuid(),
    kind: z.literal("existing"),
  }),
  z.object({
    kind: z.literal("new"),
    name: z.string().max(120),
    phone: z.string().max(32),
  }),
]);

export const panaceaRouter = {
  status: publicProcedure.query(() => ({
    service: "panacea",
    status: "ready" as const,
  })),

  listVisibleSupportSessions: clinicProcedure.query(({ ctx }) =>
    listVisibleClinicSupportSessions({
      clinicId: ctx.clinic.clinicId,
      identityId: ctx.clinic.identityId,
    }),
  ),

  getNoShowPolicy: clinicProcedure.query(({ ctx }) =>
    getNoShowPolicy(
      { clinicId: ctx.clinic.clinicId, identityId: ctx.clinic.identityId },
      drizzleNoShowPolicyStore,
    ),
  ),

  setNoShowPolicy: clinicProcedure
    .input(
      z.object({ policy: z.enum(["alert", "cancel-after-third-reminder"]) }),
    )
    .mutation(({ ctx, input }) =>
      setNoShowPolicy(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleNoShowPolicyStore,
      ),
    ),

  listPendingCases: clinicProcedure
    .input(
      z.object({
        category: z.enum(["all", "conversation", "appointment", "delivery"]),
        status: z.enum(["open", "resolved"]),
      }),
    )
    .query(({ ctx, input }) =>
      listPendingCases(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzlePendingStore,
      ),
    ),

  resolvePendingCase: clinicProcedure
    .input(
      z.object({
        category: z.enum(["conversation", "appointment", "delivery"]),
        id: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      resolvePendingCase(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzlePendingResolver,
      ),
    ),

  getConfigurationOverview: clinicProcedure.query(async ({ ctx }) => {
    const overview = await getPanaceaConfigurationOverview(
      {
        clinicId: ctx.clinic.clinicId,
        identityId: ctx.clinic.identityId,
      },
      drizzlePanaceaConfigurationReader,
    );
    return filterPanaceaConfigurationOverview(overview, ctx.clinic.role);
  }),

  listTeam: clinicProcedure.query(({ ctx }) =>
    listPanaceaTeam(
      {
        clinicId: ctx.clinic.clinicId,
        identityId: ctx.clinic.identityId,
      },
      drizzlePanaceaTeamReader,
    ),
  ),

  listTransactionalDeliveryAlerts: clinicProcedure.query(({ ctx }) =>
    listTransactionalDeliveryAlerts({
      clinicId: ctx.clinic.clinicId,
      identityId: ctx.clinic.identityId,
    }),
  ),

  resolveTransactionalDeliveryAlert: clinicProcedure
    .input(z.object({ alertId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      resolveTransactionalDeliveryAlert({
        ...input,
        clinicId: ctx.clinic.clinicId,
        identityId: ctx.clinic.identityId,
        now: new Date(),
      }),
    ),

  acceptClinicInvitation: publicProcedure
    .input(
      z.object({
        password: z.string(),
        token: z.string(),
      }),
    )
    .mutation(({ input }) => acceptClinicInvitation(input)),

  inviteAdditionalDoctor: clinicProcedure
    .input(
      z.object({
        email: z.string().trim().email(),
        name: z.string().trim().min(1).max(120),
      }),
    )
    .mutation(({ ctx, input }) =>
      inviteAdditionalDoctor(
        {
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
          recipient: input,
        },
        {
          sendInvitation: (invitation) =>
            clinicInvitationEmailSender().sendDoctorInvitation({
              clinicName: invitation.clinicName,
              expiresAt: invitation.expiresAt,
              recipientEmail: invitation.email,
              recipientName: invitation.recipientName,
              token: invitation.token,
            }),
          store: drizzleDoctorInvitationStore,
        },
      ),
    ),

  listDoctorInvitations: clinicProcedure.query(({ ctx }) =>
    listDoctorInvitationStatuses({
      clinicId: ctx.clinic.clinicId,
      identityId: ctx.clinic.identityId,
    }),
  ),

  listDoctors: clinicProcedure.query(async ({ ctx }) => {
    const doctors = await listDoctors({
      clinicId: ctx.clinic.clinicId,
      identityId: ctx.clinic.identityId,
    });
    if (ctx.clinic.role !== "owner") throw new DoctorDeactivationAccessError();
    return doctors;
  }),

  deactivateDoctor: clinicProcedure
    .input(z.object({ doctorId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      deactivateDoctor(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleDoctorStatusStore,
      ),
    ),

  completeOwnDoctorProfile: clinicProcedure
    .input(
      z.object({
        primarySpecialty: z.string().max(160),
        publicName: z.string().max(120),
      }),
    )
    .mutation(({ ctx, input }) =>
      completeOwnDoctorProfile({
        ...input,
        clinicId: ctx.clinic.clinicId,
        identityId: ctx.clinic.identityId,
      }),
    ),

  listAdministrativeRecords: clinicProcedure.query(({ ctx }) =>
    listAdministrativeRecords(
      {
        clinicId: ctx.clinic.clinicId,
        identityId: ctx.clinic.identityId,
      },
      drizzleAdministrativeRecordsStore,
    ),
  ),

  listPendingGuardianshipVerifications: clinicProcedure.query(({ ctx }) =>
    listPendingGuardianshipVerifications(
      {
        clinicId: ctx.clinic.clinicId,
        identityId: ctx.clinic.identityId,
      },
      drizzleAdministrativeRecordsStore,
    ),
  ),

  listPatientDirectory: clinicProcedure
    .input(
      z.object({
        query: z.string().max(120).optional(),
        searchTarget: z.enum(["contacts", "patients"]).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      listPatientDirectory(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleAdministrativeRecordsStore,
      ),
    ),

  findContactByPhone: clinicProcedure
    .input(z.object({ phone: z.string().max(32) }))
    .query(({ ctx, input }) =>
      findContactByPhone(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleAdministrativeRecordsStore,
      ),
    ),

  getPatientAdministrativeDetail: clinicProcedure
    .input(z.object({ patientId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      getPatientAdministrativeDetail(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleAdministrativeRecordsStore,
      ),
    ),

  registerPatient: clinicProcedure
    .input(
      z.object({
        birthDate: z.string().max(10),
        contact: patientContactInput,
        guardianDui: z.string().max(10).optional(),
        patientName: z.string().max(120),
        relationship: z.enum(["contact", "tutor"]).default("contact"),
      }),
    )
    .mutation(({ ctx, input }) =>
      registerPatient(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
          contact:
            input.contact.kind === "existing"
              ? input.contact
              : {
                  kind: "new",
                  name: input.contact.name,
                  phone: input.contact.phone,
                },
        },
        drizzleAdministrativeRecordsStore,
      ),
    ),

  createIncompletePatient: clinicProcedure
    .input(
      z.object({
        birthDate: z.string().max(10),
        name: z.string().max(120),
      }),
    )
    .mutation(({ ctx, input }) =>
      createIncompletePatient(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleAdministrativeRecordsStore,
      ),
    ),

  addPatientContact: clinicProcedure
    .input(
      z.object({
        contact: patientContactInput,
        guardianDui: z.string().max(10).optional(),
        patientId: z.string().uuid(),
        relationship: z.enum(["contact", "tutor"]).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      addPatientContact(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
          contact:
            input.contact.kind === "existing"
              ? input.contact
              : {
                  kind: "new",
                  name: input.contact.name,
                  phone: input.contact.phone,
                },
        },
        drizzleAdministrativeRecordsStore,
      ),
    ),

  verifyPatientGuardianship: clinicProcedure
    .input(z.object({ linkId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      verifyPatientGuardianship(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleAdministrativeRecordsStore,
      ),
    ),

  createContact: clinicProcedure
    .input(
      z.object({
        name: z.string().max(120),
        phone: z.string().max(32),
      }),
    )
    .mutation(({ ctx, input }) =>
      createContact(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleAdministrativeRecordsStore,
      ),
    ),

  updateContact: clinicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().max(120),
        phone: z.string().max(32),
      }),
    )
    .mutation(({ ctx, input }) =>
      updateContact(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleAdministrativeRecordsStore,
      ),
    ),

  createPatient: clinicProcedure
    .input(
      z.object({
        birthDate: z.string().max(10),
        name: z.string().max(120),
      }),
    )
    .mutation(({ ctx, input }) =>
      createPatient(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleAdministrativeRecordsStore,
      ),
    ),

  updatePatient: clinicProcedure
    .input(
      z.object({
        birthDate: z.string().max(10),
        id: z.string().uuid(),
        name: z.string().max(120),
      }),
    )
    .mutation(({ ctx, input }) =>
      updatePatient(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleAdministrativeRecordsStore,
      ),
    ),

  createContactPatientLink: clinicProcedure
    .input(
      z.object({
        contactId: z.string().uuid(),
        patientId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      createContactPatientLink(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleAdministrativeRecordsStore,
      ),
    ),

  registerAdministrativeRecordsForManualAppointment: clinicProcedure
    .input(
      z.object({
        birthDate: z.string().max(10),
        contactName: z.string().max(120),
        patientName: z.string().max(120),
        phone: z.string().max(32),
      }),
    )
    .mutation(({ ctx, input }) =>
      registerAdministrativeRecordsForManualAppointment(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleAdministrativeRecordsStore,
      ),
    ),

  listServiceCatalog: clinicProcedure.query(async ({ ctx }) => {
    const catalog = await listServiceCatalog({
      clinicId: ctx.clinic.clinicId,
      identityId: ctx.clinic.identityId,
    });
    if (catalog === undefined) throw new ServiceCatalogAccessError();
    return catalog;
  }),

  createService: clinicProcedure
    .input(
      z.object({
        description: z.string().max(1_000),
        name: z.string().max(120),
        offers: z
          .array(
            z.object({
              bufferMinutes: z.number().int().nonnegative(),
              doctorId: z.string().uuid(),
              durationMinutes: z.number().int().positive(),
              priceUsd: z.string(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      createService(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleServiceCatalogStore,
      ),
    ),

  updateService: clinicProcedure
    .input(
      z.object({
        description: z.string().max(1_000),
        name: z.string().max(120),
        serviceId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      updateService(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleServiceCatalogStore,
      ),
    ),

  addServiceOffer: clinicProcedure
    .input(
      z.object({
        bufferMinutes: z.number().int().nonnegative(),
        doctorId: z.string().uuid(),
        durationMinutes: z.number().int().positive(),
        priceUsd: z.string(),
        serviceId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      addServiceOffer(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleServiceCatalogStore,
      ),
    ),

  updateServiceOffer: clinicProcedure
    .input(
      z.object({
        bufferMinutes: z.number().int().nonnegative(),
        durationMinutes: z.number().int().positive(),
        offerId: z.string().uuid(),
        priceUsd: z.string(),
      }),
    )
    .mutation(({ ctx, input }) =>
      updateServiceOffer(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleServiceCatalogStore,
      ),
    ),

  deactivateServiceOffer: clinicProcedure
    .input(z.object({ offerId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      deactivateServiceOffer(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleServiceCatalogStore,
      ),
    ),

  listAvailabilityConfiguration: clinicProcedure.query(async ({ ctx }) => {
    const availability = await listAvailabilityConfiguration({
      clinicId: ctx.clinic.clinicId,
      identityId: ctx.clinic.identityId,
    });
    if (availability === undefined) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "La Identidad no puede consultar esta disponibilidad",
      });
    }
    return availability;
  }),

  listCareOptions: clinicProcedure
    .input(
      z.object({
        doctorId: z.string().uuid(),
        from: z.string(),
        serviceId: z.string().uuid(),
        to: z.string(),
      }),
    )
    .query(({ ctx, input }) =>
      calculateCareOptions(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleCareOptionsStore,
      ),
    ),

  listManualAppointmentFormData: clinicProcedure.query(({ ctx }) =>
    listManualAppointmentFormData(
      {
        clinicId: ctx.clinic.clinicId,
        identityId: ctx.clinic.identityId,
      },
      drizzleManualAppointmentStore,
    ),
  ),

  listPanaceaCalendar: clinicProcedure
    .input(
      z.object({
        doctorId: z.string().uuid().optional(),
        from: z.coerce.date(),
        to: z.coerce.date(),
      }),
    )
    .query(({ ctx, input }) =>
      listPanaceaCalendar(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleManualAppointmentStore,
      ),
    ),

  listPanaceaCalendarDoctors: clinicProcedure.query(({ ctx }) =>
    listPanaceaCalendarDoctors(
      {
        clinicId: ctx.clinic.clinicId,
        identityId: ctx.clinic.identityId,
      },
      drizzleManualAppointmentStore,
    ),
  ),

  listManualAppointments: clinicProcedure.query(({ ctx }) =>
    listManualAppointments(
      {
        clinicId: ctx.clinic.clinicId,
        identityId: ctx.clinic.identityId,
      },
      drizzleManualAppointmentStore,
    ),
  ),

  listCancelledManualAppointments: clinicProcedure.query(({ ctx }) =>
    listCancelledManualAppointments(
      {
        clinicId: ctx.clinic.clinicId,
        identityId: ctx.clinic.identityId,
      },
      drizzleManualAppointmentStore,
    ),
  ),

  listAppointmentSelfManagementEscalations: clinicProcedure.query(({ ctx }) =>
    listAppointmentSelfManagementEscalations(
      {
        clinicId: ctx.clinic.clinicId,
        identityId: ctx.clinic.identityId,
      },
      drizzleAppointmentSelfManagementEscalationReader,
    ),
  ),

  resolveAppointmentSelfManagementEscalation: clinicProcedure
    .input(z.object({ escalationId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      resolveAppointmentSelfManagementEscalation(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleAppointmentSelfManagementEscalationResolver,
      ),
    ),

  listConversationEscalations: clinicProcedure.query(({ ctx }) =>
    listConversationEscalations(
      {
        clinicId: ctx.clinic.clinicId,
        identityId: ctx.clinic.identityId,
      },
      drizzleConversationEscalationReader,
    ),
  ),

  resolveConversationEscalation: clinicProcedure
    .input(z.object({ escalationId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      resolveConversationEscalation(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleConversationEscalationResolver,
      ),
    ),

  getEscalationNotificationSettings: clinicProcedure.query(({ ctx }) =>
    getEscalationNotificationSettings(
      {
        clinicId: ctx.clinic.clinicId,
        identityId: ctx.clinic.identityId,
      },
      drizzleEscalationNotificationSettingsStore,
    ),
  ),

  setEscalationNotificationSettings: clinicProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        secretaryPhoneE164: z.string().max(32).nullable(),
      }),
    )
    .mutation(({ ctx, input }) =>
      setEscalationNotificationSettings(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleEscalationNotificationSettingsStore,
      ),
    ),

  getVoiceTranscriptionSettings: clinicProcedure.query(({ ctx }) =>
    getVoiceTranscriptionSettings(
      { clinicId: ctx.clinic.clinicId, identityId: ctx.clinic.identityId },
      drizzleVoiceTranscriptionSettingsStore,
    ),
  ),

  setVoiceTranscriptionSettings: clinicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ ctx, input }) =>
      setVoiceTranscriptionSettings(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleVoiceTranscriptionSettingsStore,
      ),
    ),

  createManualAppointment: clinicProcedure
    .input(
      z.object({
        doctorId: z.string().uuid(),
        patientId: z.string().uuid(),
        serviceOfferId: z.string().uuid(),
        startsAt: z.coerce.date(),
        outsideScheduleConfirmed: z.boolean().optional(),
        notificationRecipientContactId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      createManualAppointment(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleManualAppointmentStore,
        undefined,
        whatsAppSender().appointmentMessageSender,
      ),
    ),

  cancelManualAppointment: clinicProcedure
    .input(
      z.object({
        appointmentId: z.string().uuid(),
        notificationRecipientContactId: z.string().uuid().optional(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      cancelManualAppointment(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleManualAppointmentStore,
        undefined,
        whatsAppSender().appointmentMessageSender,
      ),
    ),

  configureEffectiveSchedule: clinicProcedure
    .input(
      z.object({
        doctorId: z.string().uuid(),
        effectiveFrom: z.string(),
        periods: z
          .array(
            z.object({
              dayOfWeek: z.number().int().min(0).max(6),
              endTime: z.string(),
              startTime: z.string(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      configureEffectiveSchedule(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleAvailabilityStore,
      ),
    ),

  createAvailabilityBlock: clinicProcedure
    .input(
      z.object({
        doctorId: z.string().uuid(),
        endsAt: z.coerce.date(),
        privateLabel: z.string().max(160).optional(),
        startsAt: z.coerce.date(),
      }),
    )
    .mutation(({ ctx, input }) =>
      createAvailabilityBlock(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleAvailabilityStore,
      ),
    ),

  createAvailabilityBlocks: clinicProcedure
    .input(
      z.object({
        doctorIds: z.array(z.string().uuid()).min(1),
        endsAt: z.coerce.date(),
        privateLabel: z.string().max(160).optional(),
        startsAt: z.coerce.date(),
      }),
    )
    .mutation(({ ctx, input }) =>
      createAvailabilityBlocks(
        {
          ...input,
          clinicId: ctx.clinic.clinicId,
          identityId: ctx.clinic.identityId,
        },
        drizzleAvailabilityStore,
      ),
    ),

  createSyntheticClinic: protectedProcedure
    .input(
      z.object({
        clinicName: z.string().trim().min(1).max(120),
        ownerEmail: z.string().trim().email(),
        ownerName: z.string().trim().min(1).max(120),
      }),
    )
    .mutation(({ ctx, input }) =>
      createSyntheticClinic(
        {
          actorIdentityId: ctx.session.user.id,
          clinicName: input.clinicName,
          owner: { email: input.ownerEmail, name: input.ownerName },
        },
        {
          registry: drizzleSyntheticClinicRegistration,
          sendOwnerInvitation: (invitation) =>
            clinicInvitationEmailSender().sendOwnerInvitation(invitation),
        },
      ),
    ),

  performSyntheticClinicalAction: clinicProcedure.mutation(({ ctx }) => {
    if (
      !canAccessPanaceaTechnicalSurface({
        nodeEnv: env.NODE_ENV,
        role: ctx.clinic.role,
      })
    ) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return performSyntheticClinicalAction({
      clinicId: ctx.clinic.clinicId,
      identityId: ctx.clinic.identityId,
    });
  }),
};
