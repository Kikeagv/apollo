import { randomUUID } from "node:crypto";
import { z } from "zod";

import { env } from "~/env";
import {
  clinicRegistrationModes,
  registerClinic,
  retryClinicInvitation,
  type ClinicRegistration,
  type ClinicInvitationDeliveryRequest,
} from "~/server/application/clinic-registration";
import {
  getKapsoWhatsAppOnboarding,
  prepareKapsoWhatsAppOnboarding,
} from "~/server/application/kapso-onboarding";
import { manageKapsoWhatsAppSetupLink } from "~/server/application/whatsapp-setup-links";
import { createSubscriptionSupport } from "~/server/application/subscription-support";
import {
  enableWhatsAppRealTraffic,
  getWhatsAppOperations,
  offboardWhatsAppConnection,
  recordWhatsAppTrafficGate,
  revertWhatsAppRealTraffic,
  runWhatsAppSyntheticSmoke,
} from "~/server/application/whatsapp-operations";
import {
  getWhatsAppActivationContract,
  recordWhatsAppActivationEvidence,
} from "~/server/application/whatsapp-activation";
import {
  drizzleWhatsAppRuntimeDiagnosticReader,
  getWhatsAppRuntimeDiagnostic,
} from "~/server/application/whatsapp-runtime";
import {
  getWhatsAppReadiness,
  retryWhatsAppReadiness,
} from "~/server/application/whatsapp-readiness";
import {
  getWhatsAppCircuitBreaker,
  getWhatsAppOperationalMetrics,
  openWhatsAppCircuitBreaker,
  reactivateWhatsAppCircuitBreaker,
} from "~/server/application/whatsapp-circuit-breaker";
import { protectedProcedure } from "~/server/api/trpc";
import {
  drizzleSubscriptionSupportStore,
  listCommercialClinics,
  readAuditedSupportClinicSummary,
} from "~/server/db/subscription-support-store";
import { drizzleClinicRegistrationStore } from "~/server/db/clinic-registration-store";
import { drizzleKapsoOnboardingStore } from "~/server/db/kapso-onboarding-store";
import { drizzleWhatsAppReadinessStore } from "~/server/db/whatsapp-readiness-store";
import { drizzleWhatsAppCircuitBreakerStore } from "~/server/db/whatsapp-circuit-breaker-store";
import { drizzleWhatsAppOperationsStore } from "~/server/db/whatsapp-operations-store";
import { drizzleWhatsAppActivationEvidenceStore } from "~/server/db/whatsapp-activation-evidence-store";
import {
  listWhatsAppInboundOperationalAlerts,
  resolveWhatsAppInboundOperationalAlert,
} from "~/server/db/whatsapp-inbound-alert-store";
import { clinicInvitationEmailSender } from "~/server/email/clinic-invitation-email";
import { createKapsoOnboardingProvider } from "~/server/whatsapp/kapso-onboarding";
import { createKapsoWebhookOffboardingProvider } from "~/server/whatsapp/kapso-provisioning";
import { createKapsoReadinessProvider } from "~/server/whatsapp/kapso-readiness";
import { createSimulatedWhatsAppSyntheticSmokeRunner } from "~/server/whatsapp/simulated-whatsapp-smoke";
import {
  isValidE164PhoneNumber,
  whatsappOnboardingModes,
} from "~/domain/whatsapp-preflight";
import { whatsappRealTrafficGateCodes } from "~/domain/whatsapp-traffic";
import {
  whatsappActivationCriterionCodes,
  whatsappActivationEvidenceSources,
} from "~/domain/whatsapp-activation";

const subscriptionSupport = createSubscriptionSupport(
  drizzleSubscriptionSupportStore,
);
const kapsoOnboardingProvider = createKapsoOnboardingProvider({
  apiKey: env.KAPSO_API_KEY,
});
const kapsoReadinessProvider = createKapsoReadinessProvider({
  apiKey: env.KAPSO_API_KEY,
});
const kapsoWebhookOffboardingProvider = createKapsoWebhookOffboardingProvider({
  apiKey: env.KAPSO_API_KEY,
});

function sendClinicOwnerInvitation(
  invitation: ClinicInvitationDeliveryRequest,
) {
  return clinicInvitationEmailSender().sendOwnerInvitation({
    clinicName: invitation.clinicName,
    expiresAt: invitation.expiresAt,
    ownerEmail: invitation.email,
    ownerName: invitation.recipientName,
    token: invitation.token,
  });
}

function withLegacyClinicSummary(registration: ClinicRegistration) {
  return {
    ...registration,
    id: registration.clinic.id,
    isSynthetic: registration.clinic.isSynthetic,
    name: registration.clinic.name,
  };
}

/** Operación comercial de Apolo, separada de los procedimientos de Panacea. */
export const apoloRouter = {
  listWhatsAppInboundAlerts: protectedProcedure.query(({ ctx }) =>
    listWhatsAppInboundOperationalAlerts({ identityId: ctx.session.user.id }),
  ),

  resolveWhatsAppInboundAlert: protectedProcedure
    .input(z.object({ alertId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      resolveWhatsAppInboundOperationalAlert({
        ...input,
        identityId: ctx.session.user.id,
        now: new Date(),
      }),
    ),

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
        idempotencyKey: z.string().trim().min(1).max(200).default(randomUUID),
        mode: z.enum(clinicRegistrationModes).default("commercial"),
        ownerEmail: z.string().trim().email(),
        ownerName: z.string().trim().min(1).max(120),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      withLegacyClinicSummary(
        await registerClinic(
          {
            actorIdentityId: ctx.session.user.id,
            clinicName: input.clinicName,
            idempotencyKey: input.idempotencyKey,
            mode: input.mode,
            owner: { email: input.ownerEmail, name: input.ownerName },
          },
          {
            sendOwnerInvitation: sendClinicOwnerInvitation,
            store: drizzleClinicRegistrationStore,
          },
        ),
      ),
    ),

  retryClinicInvitation: protectedProcedure
    .input(z.object({ clinicId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      retryClinicInvitation(
        { actorIdentityId: ctx.session.user.id, clinicId: input.clinicId },
        {
          sendOwnerInvitation: sendClinicOwnerInvitation,
          store: drizzleClinicRegistrationStore,
        },
      ),
    ),

  getClinicRegistration: protectedProcedure
    .input(z.object({ clinicId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      drizzleClinicRegistrationStore.read({
        actorIdentityId: ctx.session.user.id,
        clinicId: input.clinicId,
      }),
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

  getWhatsAppReadiness: protectedProcedure
    .input(z.object({ clinicId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      getWhatsAppReadiness(
        {
          access: "superadmin",
          actorIdentityId: ctx.session.user.id,
          clinicId: input.clinicId,
        },
        drizzleWhatsAppReadinessStore,
      ),
    ),

  retryWhatsAppReadiness: protectedProcedure
    .input(
      z.object({
        action: z.enum([
          "templates",
          "billing",
          "e2e",
          "webhooks",
          "reactivate",
        ]),
        clinicId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      retryWhatsAppReadiness(
        { ...input, actorIdentityId: ctx.session.user.id },
        {
          provider: kapsoReadinessProvider,
          circuitBreaker: drizzleWhatsAppCircuitBreakerStore,
          store: drizzleWhatsAppReadinessStore,
        },
      ),
    ),

  getWhatsAppOperations: protectedProcedure
    .input(z.object({ clinicId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      getWhatsAppOperations(
        { actorIdentityId: ctx.session.user.id, clinicId: input.clinicId },
        drizzleWhatsAppOperationsStore,
      ),
    ),

  getWhatsAppActivationContract: protectedProcedure
    .input(z.object({ clinicId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      getWhatsAppActivationContract(
        {
          actorIdentityId: ctx.session.user.id,
          clinicId: input.clinicId,
          // protectedProcedure garantiza que la sesión de esta solicitud está autenticada.
          identityStatus: "authenticated",
        },
        {
          evidenceStore: drizzleWhatsAppActivationEvidenceStore,
          onboardingStore: drizzleKapsoOnboardingStore,
          operationsStore: drizzleWhatsAppOperationsStore,
        },
      ),
    ),

  recordWhatsAppActivationEvidence: protectedProcedure
    .input(
      z
        .object({
          clinicId: z.string().uuid(),
          criterionCode: z.enum(whatsappActivationCriterionCodes),
          evidenceReference: z.string().trim().max(500).nullable().optional(),
          pendingReason: z.string().trim().max(500).nullable().optional(),
          source: z.enum(whatsappActivationEvidenceSources),
        })
        .refine(
          (value) =>
            (value.evidenceReference?.trim() ? 1 : 0) +
              (value.pendingReason?.trim() ? 1 : 0) ===
            1,
          "Registra una referencia de evidencia o una razón de pendiente",
        ),
    )
    .mutation(({ ctx, input }) =>
      recordWhatsAppActivationEvidence(
        {
          ...input,
          actorIdentityId: ctx.session.user.id,
          evidenceReference: input.evidenceReference ?? null,
          // protectedProcedure garantiza que la sesión de esta solicitud está autenticada.
          identityStatus: "authenticated",
          pendingReason: input.pendingReason ?? null,
        },
        {
          evidenceStore: drizzleWhatsAppActivationEvidenceStore,
          onboardingStore: drizzleKapsoOnboardingStore,
          operationsStore: drizzleWhatsAppOperationsStore,
        },
      ),
    ),

  recordWhatsAppTrafficGate: protectedProcedure
    .input(
      z.object({
        clinicId: z.string().uuid(),
        code: z.enum(whatsappRealTrafficGateCodes),
        evidenceReference: z.string().trim().max(160).nullable().optional(),
        ready: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      recordWhatsAppTrafficGate(
        {
          ...input,
          actorIdentityId: ctx.session.user.id,
          evidenceReference: input.evidenceReference ?? null,
        },
        drizzleWhatsAppOperationsStore,
      ),
    ),

  runWhatsAppSyntheticSmoke: protectedProcedure
    .input(
      z.object({
        clinicId: z.string().uuid(),
        testContactPhoneE164: z
          .string()
          .trim()
          .refine(isValidE164PhoneNumber)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actorIdentityId = ctx.session.user.id;
      return runWhatsAppSyntheticSmoke(
        {
          actorIdentityId,
          clinicId: input.clinicId,
          testContactPhoneE164: input.testContactPhoneE164,
        },
        {
          runner: {
            async run(smokeInput) {
              const snapshot = await drizzleWhatsAppOperationsStore.read({
                actorIdentityId,
                clinicId: input.clinicId,
              });
              if (snapshot.connection?.provider === "simulated") {
                return createSimulatedWhatsAppSyntheticSmokeRunner().run(
                  smokeInput,
                );
              }
              if (kapsoReadinessProvider.runSyntheticSmoke === undefined) {
                throw new Error("Kapso no expone el runner de smoke sintético");
              }
              return kapsoReadinessProvider.runSyntheticSmoke(smokeInput);
            },
          },
          store: drizzleWhatsAppOperationsStore,
        },
      );
    }),

  enableWhatsAppRealTraffic: protectedProcedure
    .input(
      z.object({
        clinicId: z.string().uuid(),
        manualConfirmation: z.literal(true),
      }),
    )
    .mutation(({ ctx, input }) =>
      enableWhatsAppRealTraffic(
        { ...input, actorIdentityId: ctx.session.user.id },
        { store: drizzleWhatsAppOperationsStore },
      ),
    ),

  revertWhatsAppRealTraffic: protectedProcedure
    .input(
      z.object({
        clinicId: z.string().uuid(),
        manualConfirmation: z.literal(true),
        reason: z.string().trim().min(1).max(500),
      }),
    )
    .mutation(({ ctx, input }) =>
      revertWhatsAppRealTraffic(
        { ...input, actorIdentityId: ctx.session.user.id },
        { store: drizzleWhatsAppOperationsStore },
      ),
    ),

  offboardWhatsAppConnection: protectedProcedure
    .input(
      z.object({
        clinicId: z.string().uuid(),
        manualConfirmation: z.literal(true),
        runId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      offboardWhatsAppConnection(
        { ...input, actorIdentityId: ctx.session.user.id },
        {
          provider: kapsoWebhookOffboardingProvider,
          setupLinkProvider: kapsoOnboardingProvider,
          store: drizzleWhatsAppOperationsStore,
        },
      ),
    ),

  getWhatsAppCircuitBreaker: protectedProcedure
    .input(z.object({ clinicId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      getWhatsAppCircuitBreaker(
        {
          access: "superadmin",
          actorIdentityId: ctx.session.user.id,
          clinicId: input.clinicId,
        },
        drizzleWhatsAppCircuitBreakerStore,
      ),
    ),

  getWhatsAppOperationalMetrics: protectedProcedure
    .input(
      z.object({
        clinicId: z.string().uuid(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      getWhatsAppOperationalMetrics(
        {
          actorIdentityId: ctx.session.user.id,
          clinicId: input.clinicId,
          from: input.from,
          to: input.to,
        },
        drizzleWhatsAppCircuitBreakerStore,
      ),
    ),

  openWhatsAppCircuitBreaker: protectedProcedure
    .input(
      z.object({
        cause: z.enum([
          "webhook-paused",
          "high-failure-rate",
          "credit-exhausted",
          "quota-exhausted",
          "provider-error",
          "meta-error",
          "legal-block",
        ]),
        clinicId: z.string().uuid(),
        reason: z.string().trim().min(1).max(500),
      }),
    )
    .mutation(({ ctx, input }) =>
      openWhatsAppCircuitBreaker(
        {
          ...input,
          actorIdentityId: ctx.session.user.id,
          actorKind: "superadmin",
          now: new Date(),
        },
        drizzleWhatsAppCircuitBreakerStore,
      ),
    ),

  reactivateWhatsAppCircuitBreaker: protectedProcedure
    .input(
      z.object({
        causeFixed: z.literal(true),
        clinicId: z.string().uuid(),
        manualConfirmation: z.literal(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actorIdentityId = ctx.session.user.id;
      const readiness = await getWhatsAppReadiness(
        {
          access: "superadmin",
          actorIdentityId,
          clinicId: input.clinicId,
        },
        drizzleWhatsAppReadinessStore,
      );
      const circuit = await getWhatsAppCircuitBreaker(
        {
          access: "superadmin",
          actorIdentityId,
          clinicId: input.clinicId,
        },
        drizzleWhatsAppCircuitBreakerStore,
      );
      let latestReadiness = readiness;
      const connection = latestReadiness.connection;
      if (
        circuit.status !== "open" ||
        connection?.phoneNumberId == null ||
        readiness.projectWebhook.remoteId === null
      ) {
        throw new Error(
          "La Conexión no tiene evidencia suficiente para ejecutar la prueba sintética",
        );
      }
      const causeGate =
        circuit.cause === "webhook-paused"
          ? "webhooks"
          : circuit.cause === "credit-exhausted"
            ? "billing"
            : circuit.cause === "quota-exhausted"
              ? "billing"
              : null;
      const blockedGate = latestReadiness.readiness.gates.find(
        (gate) =>
          gate.status !== "ready" &&
          gate.code !== "number" &&
          gate.code !== "e2e" &&
          gate.code !== causeGate,
      );
      if (blockedGate !== undefined) {
        throw new Error(
          `El gate ${blockedGate.code} todavía no está listo: ${blockedGate.message}`,
        );
      }
      if (circuit.cause === "webhook-paused") {
        if (
          latestReadiness.projectWebhook.status !== "ready" ||
          latestReadiness.phoneNumberWebhook.status !== "ready"
        ) {
          throw new Error("Los webhooks de la Conexión todavía están pausados");
        }
      } else if (
        circuit.cause === "credit-exhausted" ||
        circuit.cause === "quota-exhausted"
      ) {
        latestReadiness = await retryWhatsAppReadiness(
          {
            action: "billing",
            actorIdentityId,
            clinicId: input.clinicId,
          },
          {
            provider: kapsoReadinessProvider,
            circuitBreaker: drizzleWhatsAppCircuitBreakerStore,
            store: drizzleWhatsAppReadinessStore,
          },
        );
        const billing = latestReadiness.billing;
        if (
          billing.status !== "ready" ||
          billing.creditCents <= (billing.creditReserveCents ?? 0) ||
          (circuit.cause === "quota-exhausted" &&
            billing.kapsoMonthlyQuota !== null &&
            (billing.kapsoQuotaConsumed ?? 0) +
              (billing.kapsoQuotaReserved ?? 0) +
              (billing.kapsoQuotaInFlight ?? 0) >=
              (billing.kapsoMonthlyQuota ?? 0))
        ) {
          throw new Error(
            circuit.cause === "quota-exhausted"
              ? "La cuota mensual de Kapso todavía no fue repuesta"
              : "El crédito de Kapso todavía no fue repuesto",
          );
        }
      } else if (circuit.cause !== "legal-block") {
        latestReadiness = await retryWhatsAppReadiness(
          {
            action: "reactivate",
            actorIdentityId,
            clinicId: input.clinicId,
          },
          {
            provider: kapsoReadinessProvider,
            circuitBreaker: drizzleWhatsAppCircuitBreakerStore,
            store: drizzleWhatsAppReadinessStore,
          },
        );
        if (latestReadiness.numberHealth !== "healthy") {
          throw new Error("La salud del número todavía no está recuperada");
        }
      }
      const latestConnection = latestReadiness.connection;
      if (
        latestConnection?.phoneNumberId == null ||
        latestReadiness.projectWebhook.remoteId === null
      ) {
        throw new Error(
          "La Conexión perdió evidencia mientras se verificaba la reactivación",
        );
      }
      const provisioningEventId =
        latestReadiness.provisioningEventId ??
        latestConnection.metadata.provisioningEventId ??
        null;
      const operations = await drizzleWhatsAppOperationsStore.read({
        actorIdentityId,
        clinicId: input.clinicId,
      });
      return reactivateWhatsAppCircuitBreaker(
        {
          ...input,
          actorIdentityId,
          connectionProvider: latestConnection.provider,
          e2eEvidence: operations.latestSmoke,
          now: new Date(),
          phoneNumberId: latestConnection.phoneNumberId,
          projectWebhookId: latestReadiness.projectWebhook.remoteId,
          connectionEvidence: {
            connectionUpdatedAt: latestConnection.updatedAt,
            provisioningEventId,
            readinessRevision: latestReadiness.revision ?? 0,
          },
        },
        { store: drizzleWhatsAppCircuitBreakerStore },
      );
    }),

  prepareKapsoWhatsAppOnboarding: protectedProcedure
    .input(
      z.object({
        clinicId: z.string().uuid(),
        metaAuthority: z.enum(["confirmed", "not-confirmed"]),
        numberOwnedByClinic: z.boolean(),
        onboardingMode: z.enum(whatsappOnboardingModes),
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
        amountUsd: z
          .string()
          .regex(/^\d+(\.\d{2})$/)
          .refine((amount) => Number(amount) > 0, {
            message: "El monto debe ser mayor que cero",
          }),
        clinicId: z.string().uuid(),
        operationKey: z.string().trim().min(1).max(200),
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
        operationKey: z.string().trim().min(1).max(200),
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
        operationKey: z.string().trim().min(1).max(200),
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
