import { z } from "zod";

import { createSyntheticClinic } from "~/server/application/create-synthetic-clinic";
import { drizzleSyntheticClinicRegistration } from "~/server/db/synthetic-clinic-registration";
import { sendSimulatedClinicOwnerInvitation } from "~/server/email/simulated-identity-email";
import { protectedProcedure, publicProcedure } from "~/server/api/trpc";

export const panaceaRouter = {
  status: publicProcedure.query(() => ({
    service: "panacea",
    status: "ready" as const,
  })),

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
};
