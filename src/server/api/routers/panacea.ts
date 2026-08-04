import { z } from "zod";

import { acceptClinicInvitation } from "~/server/application/accept-clinic-owner-invitation";
import { inviteAdditionalDoctor } from "~/server/application/doctor-invitations";
import { completeOwnDoctorProfile } from "~/server/application/doctor-profile";
import { createSyntheticClinic } from "~/server/application/create-synthetic-clinic";
import { performSyntheticClinicalAction } from "~/server/application/perform-synthetic-clinical-action";
import {
  configureEffectiveSchedule,
  createAvailabilityBlock,
  createAvailabilityBlocks,
} from "~/server/application/availability";
import { calculateCareOptions } from "~/server/application/care-options";
import {
  addServiceOffer,
  createService,
  deactivateServiceOffer,
  ServiceCatalogAccessError,
  updateServiceOffer,
} from "~/server/application/service-catalog";
import { drizzleSyntheticClinicRegistration } from "~/server/db/synthetic-clinic-registration";
import {
  drizzleAvailabilityStore,
  drizzleCareOptionsStore,
  listAvailabilityConfiguration,
} from "~/server/db/availability-store";
import {
  listDoctorInvitationStatuses,
  drizzleDoctorInvitationStore,
} from "~/server/db/doctor-invitation-store";
import {
  drizzleServiceCatalogStore,
  listServiceCatalog,
} from "~/server/db/service-catalog-store";
import {
  sendSimulatedClinicDoctorInvitation,
  sendSimulatedClinicOwnerInvitation,
} from "~/server/email/simulated-identity-email";
import {
  clinicProcedure,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";

export const panaceaRouter = {
  status: publicProcedure.query(() => ({
    service: "panacea",
    status: "ready" as const,
  })),

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
            sendSimulatedClinicDoctorInvitation({
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

  listAvailabilityConfiguration: clinicProcedure.query(async ({ ctx }) =>
    listAvailabilityConfiguration({
      clinicId: ctx.clinic.clinicId,
      identityId: ctx.clinic.identityId,
    }),
  ),

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
          sendOwnerInvitation: sendSimulatedClinicOwnerInvitation,
        },
      ),
    ),

  performSyntheticClinicalAction: clinicProcedure.mutation(({ ctx }) =>
    performSyntheticClinicalAction({
      clinicId: ctx.clinic.clinicId,
      identityId: ctx.clinic.identityId,
    }),
  ),
};
