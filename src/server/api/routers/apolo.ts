import { z } from "zod";

import { env } from "~/env";
import { createSyntheticClinic } from "~/server/application/create-synthetic-clinic";
import {
  getKapsoWhatsAppOnboarding,
  prepareKapsoWhatsAppOnboarding,
} from "~/server/application/kapso-onboarding";
import { manageKapsoWhatsAppSetupLink } from "~/server/application/whatsapp-setup-links";
import { createSubscriptionSupport } from "~/server/application/subscription-support";
import {
  drizzleWhatsAppRuntimeDiagnosticReader,
  getWhatsAppRuntimeDiagnostic,
} from "~/server/application/whatsapp-runtime";
import { protectedProcedure } from "~/server/api/trpc";
import {
  drizzleSubscriptionSupportStore,
  listCommercialClinics,
  readAuditedSupportClinicSummary,
} from "~/server/db/subscription-support-store";
import { drizzleSyntheticClinicRegistration } from "~/server/db/synthetic-clinic-registration";
import { drizzleKapsoOnboardingStore } from "~/server/db/kapso-onboarding-store";
import { clinicInvitationEmailSender } from "~/server/email/clinic-invitation-email";
import { createKapsoOnboardingProvider } from "~/server/whatsapp/kapso-onboarding";

const subscriptionSupport = createSubscriptionSupport(
  drizzleSubscriptionSupportStore,
);
const kapsoOnboardingProvider = createKapsoOnboardingProvider({
  apiKey: env.KAPSO_API_KEY,
});

/** Operación comercial de Apolo, separada de los procedimientos de Panacea. */
export const apoloRouter = {
  getWhatsAppRuntimeDiagnostic: protectedProcedure.query(({ ctx }) =>
    getWhatsAppRuntimeDiagnostic(
      { identityId: ctx.session.user.id },
      drizzleWhatsAppRuntimeDiagnosticReader,
    ),
  ),

  listCommercialClinics: protectedProcedure.query(({ ctx }) =>
    listCommercialClinics(ctx.session.user.id),
  ),

  createManualClinic: protectedProcedure
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

  getKapsoOnboarding: protectedProcedure
    .input(z.object({ clinicId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      getKapsoWhatsAppOnboarding(
        {
          actorIdentityId: ctx.session.user.id,
          clinicId: input.clinicId,
        },
        drizzleKapsoOnboardingStore,
        kapsoOnboardingProvider,
      ),
    ),

  prepareKapsoWhatsAppOnboarding: protectedProcedure
    .input(
      z.object({
        clinicId: z.string().uuid(),
        metaAuthority: z.enum(["confirmed", "not-confirmed"]),
        numberOwnedByClinic: z.boolean(),
        ownerConfirmed: z.boolean(),
        ownerName: z.string().trim().min(1).max(120),
        phoneNumberE164: z.string().trim().max(32),
        qrDeviceAvailable: z.boolean(),
        whatsappBusinessApp: z.enum([
          "active",
          "messenger-only",
          "not-installed",
          "not-willing",
        ]),
      }),
    )
    .mutation(({ ctx, input }) =>
      prepareKapsoWhatsAppOnboarding(
        {
          ...input,
          actorIdentityId: ctx.session.user.id,
        },
        {
          provider: kapsoOnboardingProvider,
          store: drizzleKapsoOnboardingStore,
        },
      ),
    ),

  manageKapsoWhatsAppSetupLink: protectedProcedure
    .input(
      z.object({
        action: z.enum(["generate", "regenerate", "revoke"]),
        clinicId: z.string().uuid(),
        reason: z.string().trim().min(1).max(500).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      manageKapsoWhatsAppSetupLink(
        {
          ...input,
          actorIdentityId: ctx.session.user.id,
          actorType: "superadmin",
        },
        {
          appUrl: env.PUBLIC_SITE_URL,
          provider: kapsoOnboardingProvider,
          store: drizzleKapsoOnboardingStore,
        },
      ),
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
