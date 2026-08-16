import { z } from "zod";

import { createSubscriptionSupport } from "~/server/application/subscription-support";
import { protectedProcedure } from "~/server/api/trpc";
import {
  drizzleSubscriptionSupportStore,
  listCommercialClinics,
  readAuditedSupportClinicSummary,
} from "~/server/db/subscription-support-store";

const subscriptionSupport = createSubscriptionSupport(
  drizzleSubscriptionSupportStore,
);

/** Operación comercial de Apolo, separada de los procedimientos de Panacea. */
export const apoloRouter = {
  listCommercialClinics: protectedProcedure.query(({ ctx }) =>
    listCommercialClinics(ctx.session.user.id),
  ),

  recordTransferPayment: protectedProcedure
    .input(
      z.object({
        amountUsd: z.string().regex(/^\d+(\.\d{2})$/),
        clinicId: z.string().uuid(),
        reference: z.string().trim().min(1).max(160),
      }),
    )
    .mutation(({ ctx, input }) =>
      subscriptionSupport.recordTransferPayment({
        ...input,
        recordedByIdentityId: ctx.session.user.id,
      }),
    ),

  changeSubscriptionStatus: protectedProcedure
    .input(
      z.object({
        clinicId: z.string().uuid(),
        status: z.enum(["active", "suspended"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      subscriptionSupport.changeSubscriptionStatus({
        ...input,
        changedByIdentityId: ctx.session.user.id,
      }),
    ),

  openSupportSession: protectedProcedure
    .input(
      z.object({
        clinicId: z.string().uuid(),
        expiresAt: z.coerce.date(),
        reason: z.string().trim().min(1).max(1_000),
      }),
    )
    .mutation(({ ctx, input }) =>
      subscriptionSupport.openSupportSession({
        ...input,
        superadminIdentityId: ctx.session.user.id,
      }),
    ),

  readSupportClinicSummary: protectedProcedure
    .input(
      z.object({
        clinicId: z.string().uuid(),
        supportSessionId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      readAuditedSupportClinicSummary({
        ...input,
        superadminIdentityId: ctx.session.user.id,
      }),
    ),
};
