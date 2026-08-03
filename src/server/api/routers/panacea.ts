import { z } from "zod";

import { acceptClinicInvitation } from "~/server/application/accept-clinic-owner-invitation";
import { inviteAdditionalDoctor } from "~/server/application/doctor-invitations";
import { completeOwnDoctorProfile } from "~/server/application/doctor-profile";
import { createSyntheticClinic } from "~/server/application/create-synthetic-clinic";
import { performSyntheticClinicalAction } from "~/server/application/perform-synthetic-clinical-action";
import { drizzleSyntheticClinicRegistration } from "~/server/db/synthetic-clinic-registration";
import {
  listDoctorInvitationStatuses,
  drizzleDoctorInvitationStore,
} from "~/server/db/doctor-invitation-store";
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
