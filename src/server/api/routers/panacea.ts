import { z } from "zod";

import { acceptClinicOwnerInvitation } from "~/server/application/accept-clinic-owner-invitation";
import { completeOwnDoctorProfile } from "~/server/application/doctor-profile";
import { createSyntheticClinic } from "~/server/application/create-synthetic-clinic";
import { performSyntheticClinicalAction } from "~/server/application/perform-synthetic-clinical-action";
import { drizzleSyntheticClinicRegistration } from "~/server/db/synthetic-clinic-registration";
import { sendSimulatedClinicOwnerInvitation } from "~/server/email/simulated-identity-email";
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

  acceptClinicOwnerInvitation: publicProcedure
    .input(
      z.object({
        password: z.string(),
        token: z.string(),
      }),
    )
    .mutation(({ input }) => acceptClinicOwnerInvitation(input)),

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
