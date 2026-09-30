import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  pgTableCreator,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AppointmentEventType } from "~/domain/appointment-events";
import type { ConversationEscalationTrigger } from "~/server/application/conversation-escalations";
import type {
  BookingConversation,
  WhatsAppBookingResponse,
  WhatsAppMessageOrigin,
} from "~/server/application/simulated-whatsapp-booking";
import type { PendingPriority } from "~/domain/pending";
import type { DemoRequestRateLimitScope } from "~/server/application/demo-request";
import type { WhatsAppIdentityStatus } from "~/domain/whatsapp-identity";
import type {
  WhatsAppConsentAcceptedRole,
  WhatsAppConsentScope,
  WhatsAppConsentStatus,
} from "~/domain/whatsapp-consent";
import type { NoShowPolicy } from "~/domain/whatsapp-operational-policies";
import type { ClinicReadinessStatus } from "~/domain/clinic-setup";
import type {
  WhatsAppPreflightBlocker,
  WhatsAppPreflightChecks,
  WhatsAppPreflightStatus,
  WhatsAppOnboardingMode,
} from "~/domain/whatsapp-preflight";
import type {
  WhatsAppConnectionMetadata,
  WhatsAppConnectionStatus,
  WhatsAppConnectionType,
} from "~/domain/whatsapp-connection";
import type {
  WhatsAppActivationCriterionCode,
  WhatsAppActivationEvidenceSource,
} from "~/domain/whatsapp-activation";
import type {
  WhatsAppOffboardingStepCode,
  WhatsAppOffboardingStep,
} from "~/domain/whatsapp-offboarding";
import type { WhatsAppSyntheticSmokeStep } from "~/domain/whatsapp-smoke";
import type { WhatsAppRealTrafficGateCode } from "~/domain/whatsapp-traffic";
import type {
  WhatsAppCircuitBreakerCause,
  WhatsAppCircuitBreakerStatus,
  WhatsAppUsageMetric,
} from "~/domain/whatsapp-circuit-breaker";
import type { KapsoWebhookEventPayload } from "~/domain/whatsapp-kapso-provisioning";
import type {
  WhatsAppCriticalTemplateKind,
  WhatsAppE2EEvidenceScope,
  WhatsAppKapsoFundingStatus,
  WhatsAppReadinessGateCode,
  WhatsAppTemplateCategory,
  WhatsAppTemplateProvisioningStatus,
  WhatsAppTemplateStatus,
  WhatsAppTechnicalReadinessStatus,
} from "~/domain/whatsapp-readiness";
import type { WhatsAppConnectionAlertStatus } from "~/domain/whatsapp-connection-alert";
import type { WhatsAppSetupLinkStatus } from "~/domain/whatsapp-setup-link";
import type { WhatsAppSetupLinkReturnStatus } from "~/domain/whatsapp-setup-link-return";
import type { WhatsAppProviderId } from "~/domain/whatsapp-runtime";
import type { WhatsAppDeliveryStatus } from "~/domain/whatsapp-delivery";
import type { WhatsAppInboundAlertStatus } from "~/domain/whatsapp-inbound-alert";

export const createTable = pgTableCreator((name) => `pg-drizzle_${name}`);

export type ClinicUserRole = "owner" | "doctor" | "secretary";
export type ClinicInvitationRole = "owner" | "doctor";
export type ClinicInvitationDeliveryResult = "failed" | "succeeded";
export type AppointmentOrigin = "manual" | "reservation";
export type AppointmentStatus = "confirmed" | "cancelled";
export type { NoShowPolicy } from "~/domain/whatsapp-operational-policies";
export type SubscriptionStatus = "active" | "suspended";
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
  updatedAt: timestamp("updated_at").$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
});

export const clinics = createTable(
  "clinic",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    registrationKey: text("registration_key"),
    noShowPolicy: text("no_show_policy")
      .$type<NoShowPolicy>()
      .default("alert")
      .notNull(),
    escalationNotificationsEnabled: boolean("escalation_notifications_enabled")
      .default(false)
      .notNull(),
    escalationSecretaryPhoneE164: text("escalation_secretary_phone_e164"),
    voiceTranscriptionEnabled: boolean("voice_transcription_enabled")
      .default(false)
      .notNull(),
    isSynthetic: boolean("is_synthetic").default(true).notNull(),
    subscriptionStatus: text("subscription_status")
      .$type<SubscriptionStatus>()
      .default("active")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("clinic_registration_key_unique").on(table.registrationKey),
  ],
);

/** Relación operativa única entre una Clínica y su proveedor de WhatsApp. */
export const whatsappConnections = createTable(
  "whatsapp_connection",
  {
    clinicId: uuid("clinic_id")
      .primaryKey()
      .references(() => clinics.id, { onDelete: "cascade" }),
    connectionType: text("connection_type")
      .$type<WhatsAppConnectionType>()
      .notNull(),
    customer: text("customer").notNull(),
    businessAccountId: text("business_account_id"),
    lastTestAt: timestamp("last_test_at", { withTimezone: true }),
    metadata: jsonb("metadata")
      .$type<WhatsAppConnectionMetadata>()
      .default({})
      .notNull(),
    phoneNumberE164: text("phone_number_e164"),
    phoneNumberId: text("phone_number_id"),
    provider: text("provider").$type<WhatsAppProviderId>().notNull(),
    status: text("status").$type<WhatsAppConnectionStatus>().notNull(),
    realTrafficStatus: text("real_traffic_status")
      .$type<"blocked" | "enabled" | "offboarded">()
      .default("blocked")
      .notNull(),
    realTrafficEnabledAt: timestamp("real_traffic_enabled_at", {
      withTimezone: true,
    }),
    realTrafficEnabledByIdentityId: text(
      "real_traffic_enabled_by_identity_id",
    ).references(() => user.id, { onDelete: "set null" }),
    offboardingAuthorizedAt: timestamp("offboarding_authorized_at", {
      withTimezone: true,
    }),
    offboardingAuthorizedByIdentityId: text(
      "offboarding_authorized_by_identity_id",
    ).references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_connection_customer_unique").on(table.customer),
    uniqueIndex("whatsapp_connection_business_account_id_unique")
      .on(table.businessAccountId)
      .where(sql`${table.businessAccountId} IS NOT NULL`),
    uniqueIndex("whatsapp_connection_phone_number_e164_unique")
      .on(table.phoneNumberE164)
      .where(sql`${table.phoneNumberE164} IS NOT NULL`),
    uniqueIndex("whatsapp_connection_phone_number_id_unique")
      .on(table.phoneNumberId)
      .where(sql`${table.phoneNumberId} IS NOT NULL`),
    check(
      "whatsapp_connection_real_traffic_status",
      sql`${table.realTrafficStatus} IN ('blocked', 'enabled', 'offboarded')`,
    ),
  ],
);

/** Cola durable de eventos Kapso aceptados por el webhook compartido. */
export const whatsappWebhookEvents = createTable(
  "whatsapp_webhook_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    eventName: text("event_name").notNull(),
    payload: jsonb("payload").$type<KapsoWebhookEventPayload>().notNull(),
    status: text("status")
      .$type<"pending" | "processing" | "processed" | "rejected" | "ignored">()
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    leaseToken: text("lease_token"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("whatsapp_webhook_event_idempotency_unique").on(
      table.idempotencyKey,
    ),
    index("whatsapp_webhook_event_status_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    index("whatsapp_webhook_event_phone_idx").on(
      table.eventName,
      table.receivedAt,
    ),
    check(
      "whatsapp_webhook_event_status",
      sql`${table.status} IN ('pending', 'processing', 'processed', 'rejected', 'ignored')`,
    ),
    check(
      "whatsapp_webhook_event_name",
      sql`${table.eventName} IN (
        'whatsapp.phone_number.created',
        'whatsapp.phone_number.deleted',
        'whatsapp.message.received',
        'whatsapp.message.sent',
        'whatsapp.message.delivered',
        'whatsapp.message.read',
        'whatsapp.message.failed',
        'whatsapp.conversation.created',
        'whatsapp.conversation.ended',
        'whatsapp.conversation.inactive',
        'whatsapp.contact.identity_changed'
      )`,
    ),
    check(
      "whatsapp_webhook_event_idempotency_not_blank",
      sql`btrim(${table.idempotencyKey}) <> ''`,
    ),
  ],
);

/** Resultado resumible de cada llamada de provisión para un evento. */
export const whatsappProvisioningSteps = createTable(
  "whatsapp_provisioning_step",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => whatsappWebhookEvents.id, { onDelete: "cascade" }),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    phoneNumberId: text("phone_number_id").notNull(),
    projectId: text("project_id"),
    step: text("step")
      .$type<"project-webhook" | "phone-number-webhook">()
      .notNull(),
    status: text("status").$type<"succeeded" | "failed">().notNull(),
    attempts: integer("attempts").default(0).notNull(),
    remoteId: text("remote_id"),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("whatsapp_provisioning_step_event_step_unique").on(
      table.eventId,
      table.step,
    ),
    index("whatsapp_provisioning_step_clinic_idx").on(
      table.clinicId,
      table.updatedAt,
    ),
    index("whatsapp_provisioning_step_generation_idx").on(
      table.clinicId,
      table.phoneNumberId,
      table.projectId,
      table.updatedAt,
    ),
    check(
      "whatsapp_provisioning_step_name",
      sql`${table.step} IN ('project-webhook', 'phone-number-webhook')`,
    ),
    check(
      "whatsapp_provisioning_step_status",
      sql`${table.status} IN ('succeeded', 'failed')`,
    ),
  ],
);

/** Estado durable de los gates técnicos de una Conexión Kapso. */
export const whatsappReadiness = createTable(
  "whatsapp_readiness",
  {
    clinicId: uuid("clinic_id")
      .primaryKey()
      .references(() => clinics.id, { onDelete: "cascade" }),
    phoneNumberId: text("phone_number_id"),
    businessAccountId: text("business_account_id"),
    projectId: text("project_id"),
    provisioningEventId: uuid("provisioning_event_id"),
    revision: integer("revision").default(0).notNull(),
    numberEnvironment: text("number_environment")
      .$type<"production" | "sandbox" | "unknown">()
      .default("unknown")
      .notNull(),
    numberHealth: text("number_health")
      .$type<
        "healthy" | "limited" | "degraded" | "unhealthy" | "error" | "unknown"
      >()
      .default("unknown")
      .notNull(),
    numberHealthCheckedAt: timestamp("number_health_checked_at", {
      withTimezone: true,
    }),
    projectWebhookStatus: text("project_webhook_status")
      .$type<"ready" | "pending" | "failed">()
      .default("pending")
      .notNull(),
    projectWebhookId: text("project_webhook_id"),
    projectWebhookLastAttemptAt: timestamp("project_webhook_last_attempt_at", {
      withTimezone: true,
    }),
    projectWebhookLastError: text("project_webhook_last_error"),
    phoneNumberWebhookStatus: text("phone_number_webhook_status")
      .$type<"ready" | "pending" | "failed">()
      .default("pending")
      .notNull(),
    phoneNumberWebhookId: text("phone_number_webhook_id"),
    phoneNumberWebhookLastAttemptAt: timestamp(
      "phone_number_webhook_last_attempt_at",
      { withTimezone: true },
    ),
    phoneNumberWebhookLastError: text("phone_number_webhook_last_error"),
    templatesSyncStatus: text("templates_sync_status")
      .$type<"ready" | "pending" | "failed">()
      .default("pending")
      .notNull(),
    templatesSyncLastSyncedAt: timestamp("templates_sync_last_synced_at", {
      withTimezone: true,
    }),
    templatesSyncLastError: text("templates_sync_last_error"),
    billingSyncStatus: text("billing_sync_status")
      .$type<"ready" | "pending" | "failed">()
      .default("pending")
      .notNull(),
    billingSyncLastSyncedAt: timestamp("billing_sync_last_synced_at", {
      withTimezone: true,
    }),
    billingSyncLastError: text("billing_sync_last_error"),
    e2eStatus: text("e2e_status")
      .$type<"passed" | "pending" | "failed">()
      .default("pending")
      .notNull(),
    e2eEvidenceScope: text(
      "e2e_evidence_scope",
    ).$type<WhatsAppE2EEvidenceScope | null>(),
    e2eEvidence: text("e2e_evidence"),
    e2eLastTestAt: timestamp("e2e_last_test_at", { withTimezone: true }),
    e2eLastError: text("e2e_last_error"),
    technicalStatus: text("technical_status")
      .$type<WhatsAppTechnicalReadinessStatus>()
      .default("pending")
      .notNull(),
    nextAction: text("next_action"),
    statusReason: text("status_reason").notNull(),
    reconciliationStatus: text("reconciliation_status")
      .$type<"blocked" | "pending" | "processing" | "succeeded">()
      .default("pending")
      .notNull(),
    reconciliationAttempts: integer("reconciliation_attempts")
      .default(0)
      .notNull(),
    reconciliationNextAttemptAt: timestamp("reconciliation_next_attempt_at", {
      withTimezone: true,
    }),
    reconciliationLeaseToken: text("reconciliation_lease_token"),
    reconciliationLeaseExpiresAt: timestamp("reconciliation_lease_expires_at", {
      withTimezone: true,
    }),
    reconciliationLastAttemptAt: timestamp("reconciliation_last_attempt_at", {
      withTimezone: true,
    }),
    reconciliationLastError: text("reconciliation_last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "whatsapp_readiness_number_environment",
      sql`${table.numberEnvironment} IN ('production', 'sandbox', 'unknown')`,
    ),
    check(
      "whatsapp_readiness_number_health",
      sql`${table.numberHealth} IN ('healthy', 'limited', 'degraded', 'unhealthy', 'error', 'unknown')`,
    ),
    check(
      "whatsapp_readiness_project_webhook_status",
      sql`${table.projectWebhookStatus} IN ('ready', 'pending', 'failed')`,
    ),
    check(
      "whatsapp_readiness_phone_webhook_status",
      sql`${table.phoneNumberWebhookStatus} IN ('ready', 'pending', 'failed')`,
    ),
    check(
      "whatsapp_readiness_templates_sync_status",
      sql`${table.templatesSyncStatus} IN ('ready', 'pending', 'failed')`,
    ),
    check(
      "whatsapp_readiness_billing_sync_status",
      sql`${table.billingSyncStatus} IN ('ready', 'pending', 'failed')`,
    ),
    check(
      "whatsapp_readiness_e2e_status",
      sql`${table.e2eStatus} IN ('passed', 'pending', 'failed')`,
    ),
    check(
      "whatsapp_readiness_e2e_evidence_scope",
      sql`${table.e2eEvidenceScope} IS NULL OR ${table.e2eEvidenceScope} IN ('message-roundtrip', 'webhook-preflight')`,
    ),
    check(
      "whatsapp_readiness_technical_status",
      sql`${table.technicalStatus} IN ('pending', 'ready', 'degraded', 'blocked')`,
    ),
    check(
      "whatsapp_readiness_revision_non_negative",
      sql`${table.revision} >= 0`,
    ),
    check(
      "whatsapp_readiness_reconciliation_status",
      sql`${table.reconciliationStatus} IN ('blocked', 'pending', 'processing', 'succeeded')`,
    ),
    check(
      "whatsapp_readiness_reconciliation_attempts_non_negative",
      sql`${table.reconciliationAttempts} >= 0`,
    ),
    check(
      "whatsapp_readiness_status_reason_not_blank",
      sql`btrim(${table.statusReason}) <> ''`,
    ),
  ],
);

/** Evidencia administrativa de cada gate que autoriza tráfico real. */
export const whatsappTrafficGateEvidences = createTable(
  "whatsapp_traffic_gate_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    code: text("code").$type<WhatsAppRealTrafficGateCode>().notNull(),
    ready: boolean("ready").default(false).notNull(),
    evidenceReference: text("evidence_reference"),
    recordedByIdentityId: text("recorded_by_identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_traffic_gate_evidence_clinic_code_unique").on(
      table.clinicId,
      table.code,
    ),
    index("whatsapp_traffic_gate_evidence_clinic_idx").on(
      table.clinicId,
      table.updatedAt,
    ),
    check(
      "whatsapp_traffic_gate_evidence_code",
      sql`${table.code} IN ('consent', 'contract', 'privacy', 'retention', 'dpa', 'transfers', 'billing', 'product-approval')`,
    ),
    check(
      "whatsapp_traffic_gate_evidence_reference",
      sql`${table.ready} = false OR btrim(coalesce(${table.evidenceReference}, '')) <> ''`,
    ),
  ],
);

/** Evidencia externa del cierre, separada de los gates que habilitan tráfico. */
export const whatsappActivationEvidences = createTable(
  "whatsapp_activation_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    criterionCode: text("criterion_code")
      .$type<WhatsAppActivationCriterionCode>()
      .notNull(),
    source: text("source").$type<WhatsAppActivationEvidenceSource>().notNull(),
    evidenceReference: text("evidence_reference"),
    pendingReason: text("pending_reason"),
    // Es una referencia inmutable a la generación, no una dependencia de
    // retención: el historial debe sobrevivir a la limpieza de payloads.
    provisioningEventId: uuid("provisioning_event_id"),
    recordedByIdentityId: text("recorded_by_identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("whatsapp_activation_evidence_clinic_criterion_source_idx").on(
      table.clinicId,
      table.criterionCode,
      table.source,
      table.updatedAt,
    ),
    index("whatsapp_activation_evidence_clinic_idx").on(
      table.clinicId,
      table.provisioningEventId,
      table.updatedAt,
    ),
    check(
      "whatsapp_activation_evidence_criterion_code",
      sql`${table.criterionCode} IN (
        'scope-v1',
        'product-access',
        'connection-ownership',
        'technical-readiness',
        'messaging-capacity',
        'duplicate-onboarding',
        'existing-account',
        'pending-readiness',
        'stale-health',
        'retryable-operations',
        'synthetic-smoke',
        'consent-representation',
        'offboarding',
        'simulated-connection',
        'inbound-webhook',
        'transactional-outbound',
        'commercial-clinic',
        'owner-invitation',
        'admin-idempotency',
        'clinic-console',
        'template-catalog',
        'funding-health',
        'readiness-reconciliation',
        'consent-versioning',
        'welcome-return',
        'inbound-identity',
        'transactional-delivery',
        'real-e2e',
        'circuit-reactivation',
        'controlled-offboarding',
        'supervision-panel',
        'controlled-pilot'
      )`,
    ),
    check(
      "whatsapp_activation_evidence_source",
      sql`${table.source} IN ('kapso', 'deployed')`,
    ),
    check(
      "whatsapp_activation_evidence_reference_or_pending",
      sql`(
        (btrim(coalesce(${table.evidenceReference}, '')) <> '' AND ${table.pendingReason} IS NULL)
        OR
        (btrim(coalesce(${table.pendingReason}, '')) <> '' AND ${table.evidenceReference} IS NULL)
      )`,
    ),
  ],
);

/** Resultado durable del smoke de WhatsApp con contactos sintéticos. */
export const whatsappSmokeRuns = createTable(
  "whatsapp_smoke_run",
  {
    id: uuid("id").primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    actorIdentityId: text("actor_identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    provisioningEventId: uuid("provisioning_event_id").references(
      () => whatsappWebhookEvents.id,
      { onDelete: "set null" },
    ),
    providerTransportVerified: boolean("provider_transport_verified")
      .default(false)
      .notNull(),
    requiresRealRoundtrip: boolean("requires_real_roundtrip")
      .default(false)
      .notNull(),
    testContactId: uuid("test_contact_id"),
    testContactMaskedPhone: text("test_contact_masked_phone"),
    timeoutAt: timestamp("timeout_at", { withTimezone: true }),
    timedOutAt: timestamp("timed_out_at", { withTimezone: true }),
    status: text("status").$type<"failed" | "passed" | "pending">().notNull(),
    syntheticContact: boolean("synthetic_contact").notNull(),
    realPatientsEnabled: boolean("real_patients_enabled").notNull(),
    steps: jsonb("steps").$type<WhatsAppSyntheticSmokeStep[]>().notNull(),
    blockers: jsonb("blockers")
      .$type<Array<{ code: string; message: string }>>()
      .default([])
      .notNull(),
    evidence: text("evidence"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.clinicId, table.testContactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "whatsapp_smoke_run_test_contact_fk",
    }).onDelete("restrict"),
    check(
      "whatsapp_smoke_run_status",
      sql`${table.status} IN ('failed', 'passed', 'pending')`,
    ),
    index("whatsapp_smoke_run_clinic_finished_idx").on(
      table.clinicId,
      table.finishedAt,
    ),
    uniqueIndex("whatsapp_smoke_run_one_pending_per_clinic")
      .on(table.clinicId)
      .where(sql`${table.status} = 'pending'`),
    check(
      "whatsapp_smoke_run_result_safety",
      sql`${table.status} = 'failed' OR (${table.realPatientsEnabled} = false AND (${table.syntheticContact} = true OR (${table.requiresRealRoundtrip} = true AND ${table.testContactId} IS NOT NULL)))`,
    ),
    check(
      "whatsapp_smoke_run_roundtrip_result_safety",
      sql`NOT ${table.requiresRealRoundtrip} OR ${table.status} <> 'passed' OR (${table.providerTransportVerified} = true AND ${table.testContactId} IS NOT NULL AND ${table.testContactMaskedPhone} IS NOT NULL AND ${table.realPatientsEnabled} = false)`,
    ),
    check(
      "whatsapp_smoke_run_completion",
      sql`(${table.status} = 'pending' AND ${table.finishedAt} IS NULL AND ${table.timeoutAt} IS NOT NULL) OR (${table.status} <> 'pending' AND ${table.finishedAt} IS NOT NULL)`,
    ),
  ],
);

/** Ejecución de retirada; conserva activos Meta y permite reintentar pasos. */
export const whatsappOffboardingRuns = createTable(
  "whatsapp_offboarding_run",
  {
    id: uuid("id").primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    actorIdentityId: text("actor_identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    provisioningEventId: uuid("provisioning_event_id").references(
      () => whatsappWebhookEvents.id,
      { onDelete: "set null" },
    ),
    status: text("status")
      .$type<"completed" | "failed" | "running">()
      .notNull(),
    configurationExport: jsonb("configuration_export")
      .$type<Record<string, unknown>>()
      .notNull(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("whatsapp_offboarding_run_clinic_id_unique").on(
      table.clinicId,
      table.id,
    ),
    index("whatsapp_offboarding_run_clinic_started_idx").on(
      table.clinicId,
      table.startedAt,
    ),
    check(
      "whatsapp_offboarding_run_status",
      sql`${table.status} IN ('running', 'completed', 'failed')`,
    ),
    check(
      "whatsapp_offboarding_run_completion",
      sql`${table.status} = 'running' OR ${table.completedAt} IS NOT NULL`,
    ),
    check(
      "whatsapp_offboarding_run_lease",
      sql`(${table.status} = 'running' AND ${table.leaseToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL) OR (${table.status} <> 'running' AND ${table.leaseToken} IS NULL AND ${table.leaseExpiresAt} IS NULL)`,
    ),
  ],
);

/** Evidencia append-only de cada efecto y reintento del offboarding. */
export const whatsappOffboardingStepAudits = createTable(
  "whatsapp_offboarding_step_audit",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    actorIdentityId: text("actor_identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => whatsappOffboardingRuns.id, { onDelete: "cascade" }),
    step: text("step").$type<WhatsAppOffboardingStepCode>().notNull(),
    status: text("status").$type<WhatsAppOffboardingStep["status"]>().notNull(),
    effect: text("effect").$type<WhatsAppOffboardingStep["effect"]>().notNull(),
    message: text("message").notNull(),
    evidence: text("evidence"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("whatsapp_offboarding_step_audit_run_idx").on(
      table.runId,
      table.occurredAt,
    ),
    index("whatsapp_offboarding_step_audit_clinic_idx").on(
      table.clinicId,
      table.occurredAt,
    ),
    check(
      "whatsapp_offboarding_step_audit_step",
      sql`${table.step} IN ('stop-sends', 'disconnect-connection', 'disable-project-webhook', 'disable-phone-webhook', 'revoke-setup-links', 'export-configuration')`,
    ),
    check(
      "whatsapp_offboarding_step_audit_status",
      sql`${table.status} IN ('succeeded', 'failed')`,
    ),
    check(
      "whatsapp_offboarding_step_audit_effect",
      sql`${table.effect} IN ('changed', 'already-complete')`,
    ),
    foreignKey({
      columns: [table.clinicId, table.runId],
      foreignColumns: [
        whatsappOffboardingRuns.clinicId,
        whatsappOffboardingRuns.id,
      ],
      name: "whatsapp_offboarding_step_audit_run_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Alerta operativa por gate y generación; visible al superadmin y reintentable. */
export const whatsappConnectionAlerts = createTable(
  "whatsapp_connection_alert",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    provisioningEventId: uuid("provisioning_event_id")
      .notNull()
      .references(() => whatsappWebhookEvents.id, { onDelete: "cascade" }),
    gateCode: text("gate_code").$type<WhatsAppReadinessGateCode>().notNull(),
    status: text("status")
      .$type<WhatsAppConnectionAlertStatus>()
      .default("open")
      .notNull(),
    reason: text("reason").notNull(),
    nextAction: text("next_action").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_connection_alert_generation_gate_unique").on(
      table.clinicId,
      table.provisioningEventId,
      table.gateCode,
    ),
    index("whatsapp_connection_alert_clinic_status_idx").on(
      table.clinicId,
      table.status,
      table.updatedAt,
    ),
    check(
      "whatsapp_connection_alert_gate_code",
      sql`${table.gateCode} IN ('number', 'webhooks', 'templates', 'billing', 'e2e')`,
    ),
    check(
      "whatsapp_connection_alert_status",
      sql`${table.status} IN ('open', 'resolved')`,
    ),
    check(
      "whatsapp_connection_alert_reason_not_blank",
      sql`btrim(${table.reason}) <> ''`,
    ),
    check(
      "whatsapp_connection_alert_next_action_not_blank",
      sql`btrim(${table.nextAction}) <> ''`,
    ),
    check(
      "whatsapp_connection_alert_resolution",
      sql`${table.status} = 'open' OR ${table.resolvedAt} IS NOT NULL`,
    ),
  ],
);

/** Catálogo sincronizado por Clínica, sin tokens ni contenido clínico. */
export const whatsappCriticalTemplates = createTable(
  "whatsapp_critical_template",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    provisioningEventId: uuid("provisioning_event_id"),
    kind: text("kind").$type<WhatsAppCriticalTemplateKind>().notNull(),
    category: text("category").$type<WhatsAppTemplateCategory | null>(),
    catalogVersion: integer("catalog_version").default(1).notNull(),
    content: text("content").default("").notNull(),
    examples: jsonb("examples")
      .$type<Record<string, string>>()
      .default({})
      .notNull(),
    providerTemplateId: text("provider_template_id"),
    name: text("name").notNull(),
    locale: text("locale").notNull(),
    variables: jsonb("variables").$type<string[]>().default([]).notNull(),
    status: text("status").$type<WhatsAppTemplateStatus>().notNull(),
    provisioningStatus: text("provisioning_status")
      .$type<WhatsAppTemplateProvisioningStatus>()
      .default("missing")
      .notNull(),
    rejectionReason: text("rejection_reason"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("whatsapp_critical_template_clinic_kind_unique").on(
      table.clinicId,
      table.kind,
    ),
    index("whatsapp_critical_template_clinic_idx").on(table.clinicId),
    check(
      "whatsapp_critical_template_kind",
      sql`${table.kind} IN ('confirmation', 'reminder', 'cancellation', 'reschedule')`,
    ),
    check(
      "whatsapp_critical_template_category",
      sql`${table.category} IS NULL OR ${table.category} IN ('AUTHENTICATION', 'MARKETING', 'UTILITY')`,
    ),
    check(
      "whatsapp_critical_template_status",
      sql`${table.status} IN ('PENDING', 'APPROVED', 'REJECTED', 'DISABLED')`,
    ),
    check(
      "whatsapp_critical_template_catalog_version",
      sql`${table.catalogVersion} > 0`,
    ),
    check(
      "whatsapp_critical_template_provisioning_status",
      sql`${table.provisioningStatus} IN ('missing', 'submitted', 'in_review', 'approved', 'rejected')`,
    ),
  ],
);

/** Billing partner-managed atribuido a una Clínica; solo valores monetarios. */
export const whatsappBilling = createTable(
  "whatsapp_billing",
  {
    clinicId: uuid("clinic_id")
      .primaryKey()
      .references(() => clinics.id, { onDelete: "cascade" }),
    mode: text("mode")
      .$type<"partner_managed" | "customer_managed" | "unknown">()
      .default("unknown")
      .notNull(),
    creditCents: integer("credit_cents").default(0).notNull(),
    creditLimitCents: integer("credit_limit_cents"),
    creditReserveCents: integer("credit_reserve_cents"),
    creditInFlightCents: integer("credit_in_flight_cents").default(0).notNull(),
    consumedCents: integer("consumed_cents").default(0).notNull(),
    alertThresholdCents: integer("alert_threshold_cents"),
    estimatedDailyConsumptionCents: integer("estimated_daily_consumption_cents")
      .default(0)
      .notNull(),
    warningBalancePercent: integer("warning_balance_percent")
      .default(20)
      .notNull(),
    criticalBalancePercent: integer("critical_balance_percent")
      .default(10)
      .notNull(),
    warningAutonomyDays: integer("warning_autonomy_days").default(7).notNull(),
    criticalAutonomyDays: integer("critical_autonomy_days")
      .default(3)
      .notNull(),
    kapsoMonthlyQuota: integer("kapso_monthly_quota"),
    kapsoQuotaPeriod: text("kapso_quota_period"),
    kapsoQuotaConsumed: integer("kapso_quota_consumed").default(0).notNull(),
    kapsoQuotaReserved: integer("kapso_quota_reserved").default(0).notNull(),
    kapsoQuotaInFlight: integer("kapso_quota_in_flight").default(0).notNull(),
    creditBalanceKnown: boolean("credit_balance_known")
      .default(false)
      .notNull(),
    kapsoFundingStatus: text(
      "kapso_funding_status",
    ).$type<WhatsAppKapsoFundingStatus | null>(),
    kapsoFundingReason: text("kapso_funding_reason"),
    kapsoPaidMessagesPaused: boolean("kapso_paid_messages_paused"),
    metaChargesCents: integer("meta_charges_cents"),
    platformChargesCents: integer("platform_charges_cents"),
    chargesSeparated: boolean("charges_separated").default(false).notNull(),
    status: text("status")
      .$type<"ready" | "pending" | "failed">()
      .default("pending")
      .notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "whatsapp_billing_mode",
      sql`${table.mode} IN ('partner_managed', 'customer_managed', 'unknown')`,
    ),
    check(
      "whatsapp_billing_status",
      sql`${table.status} IN ('ready', 'pending', 'failed')`,
    ),
    check(
      "whatsapp_billing_kapso_funding_status",
      sql`${table.kapsoFundingStatus} IS NULL OR ${table.kapsoFundingStatus} IN ('funded', 'pending', 'unknown', 'not_funded', 'revoked')`,
    ),
    check(
      "whatsapp_billing_non_negative",
      sql`${table.creditCents} >= 0 AND ${table.consumedCents} >= 0 AND ${table.estimatedDailyConsumptionCents} >= 0 AND ${table.creditInFlightCents} >= 0 AND ${table.kapsoQuotaConsumed} >= 0 AND ${table.kapsoQuotaReserved} >= 0 AND ${table.kapsoQuotaInFlight} >= 0`,
    ),
    check(
      "whatsapp_billing_credit_limit_non_negative",
      sql`(${table.creditLimitCents} IS NULL OR ${table.creditLimitCents} >= 0) AND (${table.creditReserveCents} IS NULL OR ${table.creditReserveCents} >= 0)`,
    ),
    check(
      "whatsapp_billing_quota_non_negative",
      sql`${table.kapsoMonthlyQuota} IS NULL OR ${table.kapsoMonthlyQuota} >= 0`,
    ),
    check(
      "whatsapp_billing_threshold_percent",
      sql`${table.warningBalancePercent} BETWEEN 0 AND 100 AND ${table.criticalBalancePercent} BETWEEN 0 AND 100 AND ${table.criticalBalancePercent} <= ${table.warningBalancePercent}`,
    ),
    check(
      "whatsapp_billing_autonomy_days_non_negative",
      sql`${table.warningAutonomyDays} >= 0 AND ${table.criticalAutonomyDays} >= 0 AND ${table.criticalAutonomyDays} <= ${table.warningAutonomyDays}`,
    ),
    check(
      "whatsapp_billing_alert_threshold_non_negative",
      sql`${table.alertThresholdCents} IS NULL OR ${table.alertThresholdCents} >= 0`,
    ),
    check(
      "whatsapp_billing_charges_non_negative",
      sql`(${table.metaChargesCents} IS NULL OR ${table.metaChargesCents} >= 0) AND (${table.platformChargesCents} IS NULL OR ${table.platformChargesCents} >= 0)`,
    ),
  ],
);

/** Reserva idempotente de capacidad antes de cruzar el límite de Kapso. */
export const whatsappBillingReservations = createTable(
  "whatsapp_billing_reservation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    reservationKey: text("reservation_key").notNull(),
    quotaUnits: integer("quota_units").default(1).notNull(),
    creditCents: integer("credit_cents").default(1).notNull(),
    status: text("status")
      .$type<"reserved" | "settled" | "released">()
      .default("reserved")
      .notNull(),
    outcome: text("outcome").$type<
      "accepted" | "delivered" | "failed" | "unknown" | null
    >(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("whatsapp_billing_reservation_clinic_key_unique").on(
      table.clinicId,
      table.reservationKey,
    ),
    index("whatsapp_billing_reservation_clinic_status_idx").on(
      table.clinicId,
      table.status,
      table.createdAt,
    ),
    check(
      "whatsapp_billing_reservation_non_negative",
      sql`${table.quotaUnits} > 0 AND ${table.creditCents} >= 0`,
    ),
    check(
      "whatsapp_billing_reservation_status",
      sql`${table.status} IN ('reserved', 'settled', 'released')`,
    ),
  ],
);

/** Corte operativo por Clínica; no cambia ni elimina eventos pendientes. */
export const whatsappCircuitBreakers = createTable(
  "whatsapp_circuit_breaker",
  {
    clinicId: uuid("clinic_id")
      .primaryKey()
      .references(() => clinics.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<WhatsAppCircuitBreakerStatus>()
      .default("closed")
      .notNull(),
    cause: text("cause").$type<WhatsAppCircuitBreakerCause | null>(),
    reason: text("reason").default("Circuito cerrado").notNull(),
    nextAction: text("next_action")
      .default("La Conexión opera normalmente")
      .notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    lastTransitionAt: timestamp("last_transition_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    failureCount: integer("failure_count").default(0).notNull(),
    failureWindowStartedAt: timestamp("failure_window_started_at", {
      withTimezone: true,
    }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    lastSyntheticTestAt: timestamp("last_synthetic_test_at", {
      withTimezone: true,
    }),
    lastSyntheticTestStatus: text("last_synthetic_test_status").$type<
      "passed" | "failed" | null
    >(),
    lastSyntheticEvidence: text("last_synthetic_evidence"),
    lastReactivatedAt: timestamp("last_reactivated_at", {
      withTimezone: true,
    }),
    lastReactivatedByIdentityId: text(
      "last_reactivated_by_identity_id",
    ).references(() => user.id, { onDelete: "set null" }),
    revision: integer("revision").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "whatsapp_circuit_breaker_status",
      sql`${table.status} IN ('closed', 'open')`,
    ),
    check(
      "whatsapp_circuit_breaker_cause",
      sql`${table.status} = 'closed' OR ${table.cause} IS NOT NULL`,
    ),
    check(
      "whatsapp_circuit_breaker_reason_not_blank",
      sql`btrim(${table.reason}) <> '' AND btrim(${table.nextAction}) <> ''`,
    ),
    check(
      "whatsapp_circuit_breaker_failure_count",
      sql`${table.failureCount} >= 0 AND ${table.revision} >= 0`,
    ),
    check(
      "whatsapp_circuit_breaker_synthetic_status",
      sql`${table.lastSyntheticTestStatus} IS NULL OR ${table.lastSyntheticTestStatus} IN ('passed', 'failed')`,
    ),
    index("whatsapp_circuit_breaker_status_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
);

/** Alerta durable y resoluble asociada al corte vigente de una Clínica. */
export const whatsappCircuitBreakerAlerts = createTable(
  "whatsapp_circuit_breaker_alert",
  {
    clinicId: uuid("clinic_id")
      .primaryKey()
      .references(() => clinics.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<"open" | "resolved">()
      .default("open")
      .notNull(),
    cause: text("cause").$type<WhatsAppCircuitBreakerCause>().notNull(),
    reason: text("reason").notNull(),
    nextAction: text("next_action").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("whatsapp_circuit_breaker_alert_status_idx").on(
      table.status,
      table.updatedAt,
    ),
    check(
      "whatsapp_circuit_breaker_alert_status",
      sql`${table.status} IN ('open', 'resolved')`,
    ),
    check(
      "whatsapp_circuit_breaker_alert_reason_not_blank",
      sql`btrim(${table.reason}) <> '' AND btrim(${table.nextAction}) <> ''`,
    ),
    check(
      "whatsapp_circuit_breaker_alert_resolution",
      sql`${table.status} = 'open' OR ${table.resolvedAt} IS NOT NULL`,
    ),
  ],
);

/** Eventos administrativos inmutables del circuito y sus pruebas. */
export const whatsappCircuitBreakerAudits = createTable(
  "whatsapp_circuit_breaker_audit",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    actorIdentityId: text("actor_identity_id").references(() => user.id, {
      onDelete: "set null",
    }),
    actorKind: text("actor_kind")
      .$type<"superadmin" | "system" | "worker">()
      .notNull(),
    action: text("action")
      .$type<"failure-recorded" | "opened" | "synthetic-test" | "reactivated">()
      .notNull(),
    fromStatus: text("from_status").$type<WhatsAppCircuitBreakerStatus>(),
    toStatus: text("to_status").$type<WhatsAppCircuitBreakerStatus>().notNull(),
    cause: text("cause").$type<WhatsAppCircuitBreakerCause | null>(),
    reason: text("reason").notNull(),
    evidence: text("evidence"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("whatsapp_circuit_breaker_audit_clinic_idx").on(
      table.clinicId,
      table.occurredAt,
    ),
    check(
      "whatsapp_circuit_breaker_audit_reason_not_blank",
      sql`btrim(${table.reason}) <> ''`,
    ),
    check(
      "whatsapp_circuit_breaker_audit_action",
      sql`${table.action} IN ('failure-recorded', 'opened', 'synthetic-test', 'reactivated')`,
    ),
  ],
);

/** Métrica idempotente de Kapso/Meta; nunca guarda payload, teléfono o texto. */
export const whatsappUsageMetrics = createTable(
  "whatsapp_usage_metric",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    direction: text("direction")
      .$type<WhatsAppUsageMetric["direction"]>()
      .notNull(),
    category: text("category")
      .$type<WhatsAppUsageMetric["category"]>()
      .notNull(),
    operation: text("operation").notNull(),
    outcome: text("outcome")
      .$type<"accepted" | "delivered" | "failed" | "read" | "unknown">()
      .notNull(),
    templateName: text("template_name"),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    metaChargesCents: integer("meta_charges_cents").default(0).notNull(),
    platformChargesCents: integer("platform_charges_cents")
      .default(0)
      .notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("whatsapp_usage_metric_clinic_key_unique").on(
      table.clinicId,
      table.idempotencyKey,
    ),
    index("whatsapp_usage_metric_clinic_occurred_idx").on(
      table.clinicId,
      table.occurredAt,
    ),
    index("whatsapp_usage_metric_template_idx").on(
      table.clinicId,
      table.templateName,
      table.occurredAt,
    ),
    check(
      "whatsapp_usage_metric_direction",
      sql`${table.direction} IN ('inbound', 'outbound')`,
    ),
    check(
      "whatsapp_usage_metric_category",
      sql`${table.category} IN ('message', 'media', 'template', 'interactive', 'reaction', 'read-receipt')`,
    ),
    check(
      "whatsapp_usage_metric_outcome",
      sql`${table.outcome} IN ('accepted', 'delivered', 'failed', 'read', 'unknown')`,
    ),
    check(
      "whatsapp_usage_metric_non_negative",
      sql`${table.latencyMs} IS NULL OR ${table.latencyMs} >= 0`,
    ),
    check(
      "whatsapp_usage_metric_charges_non_negative",
      sql`${table.metaChargesCents} >= 0 AND ${table.platformChargesCents} >= 0`,
    ),
  ],
);

/** Estado resumible de las comprobaciones previas al enlace de Kapso. */
export const whatsappPreflights = createTable(
  "whatsapp_preflight",
  {
    clinicId: uuid("clinic_id")
      .primaryKey()
      .references(() => clinics.id, { onDelete: "cascade" }),
    customerId: text("customer_id"),
    onboardingMode: text("onboarding_mode")
      .$type<WhatsAppOnboardingMode>()
      .default("coexistence")
      .notNull(),
    status: text("status")
      .$type<WhatsAppPreflightStatus>()
      .default("not-run")
      .notNull(),
    checks: jsonb("checks").$type<WhatsAppPreflightChecks>(),
    blockers: jsonb("blockers")
      .$type<WhatsAppPreflightBlocker[]>()
      .default([])
      .notNull(),
    nextAction: text("next_action").notNull(),
    reason: text("reason"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("whatsapp_preflight_customer_idx").on(table.customerId),
    check(
      "whatsapp_preflight_onboarding_mode",
      sql`${table.onboardingMode} IN ('coexistence', 'dedicated', 'later', 'not-integrated')`,
    ),
  ],
);

/** Enlace Kapso vigente o histórico para la configuración de una Clínica. */
export const whatsappSetupLinks = createTable(
  "whatsapp_setup_link",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull(),
    kapsoSetupLinkId: text("kapso_setup_link_id").notNull(),
    url: text("url").notNull(),
    providerStatus: text("provider_status"),
    providerError: text("provider_error"),
    lastReturnStatus:
      text("last_return_status").$type<WhatsAppSetupLinkReturnStatus>(),
    lastReturnErrorCode: text("last_return_error_code"),
    lastReturnedAt: timestamp("last_returned_at", { withTimezone: true }),
    status: text("status").$type<WhatsAppSetupLinkStatus>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdByIdentityId: text("created_by_identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("whatsapp_setup_link_clinic_idx").on(table.clinicId, table.createdAt),
    index("whatsapp_setup_link_customer_idx").on(table.customerId),
    uniqueIndex("whatsapp_setup_link_kapso_id_unique").on(
      table.kapsoSetupLinkId,
    ),
    uniqueIndex("whatsapp_setup_link_active_customer_unique")
      .on(table.customerId)
      .where(sql`${table.status} = 'active'`),
    check(
      "whatsapp_setup_link_status",
      sql`${table.status} IN ('active', 'used', 'expired', 'revoked')`,
    ),
    check(
      "whatsapp_setup_link_customer_not_blank",
      sql`btrim(${table.customerId}) <> ''`,
    ),
    check(
      "whatsapp_setup_link_kapso_id_not_blank",
      sql`btrim(${table.kapsoSetupLinkId}) <> ''`,
    ),
    check(
      "whatsapp_setup_link_provider_status",
      sql`${table.providerStatus} IS NULL OR ${table.providerStatus} IN ('pending', 'completed', 'failed', 'unknown')`,
    ),
    check("whatsapp_setup_link_url_https", sql`${table.url} ~ '^https://'`),
    check(
      "whatsapp_setup_link_expiry_after_creation",
      sql`${table.expiresAt} = ${table.createdAt} + interval '30 days'`,
    ),
  ],
);

/** Evidencia del alta Kapso; nunca contiene OTP, QR, tokens ni documentos. */
export const whatsappOnboardingAuditEvents = createTable(
  "whatsapp_onboarding_audit_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    actorIdentityId: text("actor_identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    customerId: text("customer_id"),
    setupLinkId: text("setup_link_id"),
    action: text("action")
      .$type<
        | "customer-confirmed"
        | "customer-created"
        | "onboarding-provider-unavailable"
        | "offboarding-authorized"
        | "preflight-executed"
        | "setup-link-confirmed"
        | "setup-link-created"
        | "setup-link-expired"
        | "setup-link-provider-unavailable"
        | "setup-link-regenerated"
        | "setup-link-revoked"
        | "setup-link-used"
      >()
      .notNull(),
    result: text("result")
      .$type<"blocked" | "failed" | "succeeded">()
      .notNull(),
    reason: text("reason").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("whatsapp_onboarding_audit_clinic_idx").on(
      table.clinicId,
      table.occurredAt,
    ),
    index("whatsapp_onboarding_audit_setup_link_idx").on(table.setupLinkId),
  ],
);

/** Contrato vigente de aceptación de términos compartido por toda la Clínica. */
export const clinicTermsContract = createTable("clinic_terms_contract", {
  acceptanceErrorMessage: text("acceptance_error_message").notNull(),
  id: boolean("id").primaryKey(),
  currentVersion: text("current_version").notNull(),
});

/** Estado resumible de la configuración y habilitación explícita de Asclepio. */
export const clinicReadiness = createTable("clinic_readiness", {
  clinicId: uuid("clinic_id")
    .primaryKey()
    .references(() => clinics.id, { onDelete: "cascade" }),
  currentStep: integer("current_step").default(1).notNull(),
  readinessStatus: text("readiness_status")
    .$type<ClinicReadinessStatus>()
    .default("pending")
    .notNull(),
  asclepioEnabled: boolean("asclepio_enabled").default(false).notNull(),
  asclepioEnabledAt: timestamp("asclepio_enabled_at", { withTimezone: true }),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  termsAcceptedByIdentityId: text("terms_accepted_by_identity_id").references(
    () => user.id,
    { onDelete: "set null" },
  ),
  termsAcceptedVersion: text("terms_accepted_version"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const clinicUsers = createTable(
  "clinic_user",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    identityId: text("identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<ClinicUserRole>().notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("clinic_user_identity_idx").on(table.identityId),
    unique("clinic_user_clinic_id_unique").on(table.clinicId, table.id),
    uniqueIndex("clinic_user_clinic_identity_unique").on(
      table.clinicId,
      table.identityId,
    ),
    uniqueIndex("clinic_user_owner_unique")
      .on(table.clinicId)
      .where(sql`${table.role} = 'owner'`),
  ],
);

/** Perfil clínico de un Usuario de clínica que puede atender Citas. */
export const doctors = createTable(
  "doctor",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    clinicUserId: uuid("clinic_user_id").notNull(),
    publicName: text("public_name"),
    primarySpecialty: text("primary_specialty"),
    active: boolean("active").default(true).notNull(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("doctor_clinic_user_idx").on(table.clinicUserId),
    unique("doctor_clinic_id_unique").on(table.clinicId, table.id),
    index("doctor_clinic_idx").on(table.clinicId),
    foreignKey({
      columns: [table.clinicId, table.clinicUserId],
      foreignColumns: [clinicUsers.clinicId, clinicUsers.id],
      name: "doctor_clinic_user_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Catálogo público común a los Médicos de una Clínica. */
export const services = createTable(
  "service",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("service_clinic_id_unique").on(table.clinicId, table.id),
    uniqueIndex("service_clinic_normalized_name_unique").on(
      table.clinicId,
      table.normalizedName,
    ),
    index("service_clinic_idx").on(table.clinicId),
  ],
);

/** Configuración de atención activa o histórica para una pareja Médico–Servicio. */
export const serviceOffers = createTable(
  "service_offer",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    doctorId: uuid("doctor_id").notNull(),
    priceUsd: numeric("price_usd", { precision: 12, scale: 2 }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    bufferMinutes: integer("buffer_minutes").notNull(),
    active: boolean("active").default(true).notNull(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("service_offer_clinic_id_unique").on(table.clinicId, table.id),
    index("service_offer_clinic_idx").on(table.clinicId),
    index("service_offer_service_idx").on(table.serviceId),
    index("service_offer_doctor_idx").on(table.doctorId),
    foreignKey({
      columns: [table.clinicId, table.serviceId],
      foreignColumns: [services.clinicId, services.id],
      name: "service_offer_service_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.doctorId],
      foreignColumns: [doctors.clinicId, doctors.id],
      name: "service_offer_doctor_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Regla semanal histórica de disponibilidad de un Médico. */
export const effectiveSchedules = createTable(
  "effective_schedule",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    doctorId: uuid("doctor_id").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    effectiveUntil: date("effective_until", { mode: "string" }),
    timezone: text("timezone").default("America/El_Salvador").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("effective_schedule_clinic_id_unique").on(table.clinicId, table.id),
    unique("effective_schedule_clinic_doctor_id_unique").on(
      table.clinicId,
      table.doctorId,
      table.id,
    ),
    index("effective_schedule_doctor_idx").on(
      table.clinicId,
      table.doctorId,
      table.effectiveFrom,
    ),
    foreignKey({
      columns: [table.clinicId, table.doctorId],
      foreignColumns: [doctors.clinicId, doctors.id],
      name: "effective_schedule_doctor_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Franja recurrente semanal; una jornada que cruza medianoche se divide. */
export const effectiveSchedulePeriods = createTable(
  "effective_schedule_period",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    doctorId: uuid("doctor_id").notNull(),
    scheduleId: uuid("schedule_id").notNull(),
    dayOfWeek: integer("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (table) => [
    index("effective_schedule_period_schedule_idx").on(table.scheduleId),
    foreignKey({
      columns: [table.clinicId, table.doctorId],
      foreignColumns: [doctors.clinicId, doctors.id],
      name: "effective_schedule_period_doctor_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.scheduleId],
      foreignColumns: [effectiveSchedules.clinicId, effectiveSchedules.id],
      name: "effective_schedule_period_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Excepción individual de disponibilidad; su etiqueta es exclusiva de Panacea. */
export const availabilityBlocks = createTable(
  "availability_block",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    doctorId: uuid("doctor_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    privateLabel: text("private_label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("availability_block_doctor_starts_at_idx").on(
      table.clinicId,
      table.doctorId,
      table.startsAt,
    ),
    foreignKey({
      columns: [table.clinicId, table.doctorId],
      foreignColumns: [doctors.clinicId, doctors.id],
      name: "availability_block_doctor_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Cita confirmada y su período ocupado, incluidos sus snapshots cotizados. */
export const appointments = createTable(
  "appointment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    doctorId: uuid("doctor_id").notNull(),
    patientId: uuid("patient_id"),
    serviceOfferId: uuid("service_offer_id"),
    actorClinicUserId: uuid("actor_clinic_user_id"),
    authorContactId: uuid("author_contact_id"),
    sourceMessageId: text("source_message_id"),
    origin: text("origin").$type<AppointmentOrigin>(),
    priceUsd: numeric("price_usd", { precision: 12, scale: 2 }),
    durationMinutes: integer("duration_minutes"),
    bufferMinutes: integer("buffer_minutes"),
    outsideSchedule: boolean("outside_schedule").default(false).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    occupiedUntil: timestamp("occupied_until", { withTimezone: true }),
    status: text("status")
      .$type<AppointmentStatus>()
      .default("confirmed")
      .notNull(),
  },
  (table) => [
    unique("appointment_clinic_id_unique").on(table.clinicId, table.id),
    index("appointment_patient_starts_at_idx").on(
      table.clinicId,
      table.patientId,
      table.startsAt,
    ),
    index("appointment_doctor_starts_at_idx").on(
      table.clinicId,
      table.doctorId,
      table.startsAt,
    ),
    uniqueIndex("appointment_source_message_unique")
      .on(table.clinicId, table.sourceMessageId)
      .where(sql`${table.sourceMessageId} IS NOT NULL`),
    foreignKey({
      columns: [table.clinicId, table.doctorId],
      foreignColumns: [doctors.clinicId, doctors.id],
      name: "appointment_doctor_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: "appointment_patient_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.authorContactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "appointment_author_contact_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.serviceOfferId],
      foreignColumns: [serviceOffers.clinicId, serviceOffers.id],
      name: "appointment_service_offer_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId, table.actorClinicUserId],
      foreignColumns: [clinicUsers.clinicId, clinicUsers.id],
      name: "appointment_actor_same_clinic_fk",
    }).onDelete("restrict"),
  ],
);

/** Historial append-only de los cambios y mensajes asociados a una Cita. */
export const appointmentEvents = createTable(
  "appointment_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    appointmentId: uuid("appointment_id").notNull(),
    type: text("type").$type<AppointmentEventType>().notNull(),
    actorClinicUserId: uuid("actor_clinic_user_id"),
    actorContactId: uuid("actor_contact_id"),
    recipientContactId: uuid("recipient_contact_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    reason: text("reason"),
  },
  (table) => [
    index("appointment_event_appointment_idx").on(table.appointmentId),
    index("appointment_event_clinic_idx").on(table.clinicId),
    foreignKey({
      columns: [table.clinicId, table.appointmentId],
      foreignColumns: [appointments.clinicId, appointments.id],
      name: "appointment_event_appointment_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.actorClinicUserId],
      foreignColumns: [clinicUsers.clinicId, clinicUsers.id],
      name: "appointment_event_actor_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId, table.actorContactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "appointment_event_actor_contact_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId, table.recipientContactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "appointment_event_recipient_contact_same_clinic_fk",
    }).onDelete("restrict"),
  ],
);

/** Solicitud de autogestión que Asclepio deriva para resolución humana en Panacea. */
export const appointmentSelfManagementEscalations = createTable(
  "appointment_self_management_escalation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    appointmentId: uuid("appointment_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    action: text("action").$type<"cancel" | "reschedule">().notNull(),
    priority: text("priority")
      .$type<PendingPriority>()
      .default("high")
      .notNull(),
    requestedStartsAt: timestamp("requested_starts_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByClinicUserId: uuid("resolved_by_clinic_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("appointment_self_management_escalation_clinic_idx").on(
      table.clinicId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.clinicId, table.appointmentId],
      foreignColumns: [appointments.clinicId, appointments.id],
      name: "appointment_self_management_escalation_appointment_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.contactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "appointment_self_management_escalation_contact_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId, table.resolvedByClinicUserId],
      foreignColumns: [clinicUsers.clinicId, clinicUsers.id],
      name: "appointment_self_management_escalation_resolver_same_clinic_fk",
    }).onDelete("restrict"),
  ],
);

/** Ocupación temporal vigente, usada antes de confirmar una Cita. */
export const temporaryReservations = createTable(
  "temporary_reservation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    doctorId: uuid("doctor_id").notNull(),
    contactId: uuid("contact_id"),
    patientId: uuid("patient_id"),
    serviceOfferId: uuid("service_offer_id"),
    sourceMessageId: text("source_message_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("temporary_reservation_doctor_starts_at_idx").on(
      table.clinicId,
      table.doctorId,
      table.startsAt,
    ),
    uniqueIndex("temporary_reservation_source_message_unique")
      .on(table.clinicId, table.sourceMessageId)
      .where(sql`${table.sourceMessageId} IS NOT NULL`),
    foreignKey({
      columns: [table.clinicId, table.doctorId],
      foreignColumns: [doctors.clinicId, doctors.id],
      name: "temporary_reservation_doctor_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.contactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "temporary_reservation_contact_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: "temporary_reservation_patient_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId, table.serviceOfferId],
      foreignColumns: [serviceOffers.clinicId, serviceOffers.id],
      name: "temporary_reservation_service_offer_same_clinic_fk",
    }).onDelete("restrict"),
  ],
);

/** Entrega nocturna idempotente del respaldo operativo de cada Médico. */
export const dailyAgendaEmails = createTable(
  "daily_agenda_email",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    doctorId: uuid("doctor_id").notNull(),
    agendaDate: date("agenda_date", { mode: "string" }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("daily_agenda_email_doctor_date_unique").on(
      table.doctorId,
      table.agendaDate,
    ),
    foreignKey({
      columns: [table.clinicId, table.doctorId],
      foreignColumns: [doctors.clinicId, doctors.id],
      name: "daily_agenda_email_doctor_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

export type TransactionalDeliveryKind =
  "appointment-message" | "appointment-reminder" | "daily-agenda-pdf";
export type TransactionalDeliveryStatus =
  | "accepted"
  | "delivered"
  | "failed"
  | "pending"
  | "processing"
  | "read"
  | "sent"
  | "suppressed"
  | "unknown";

/** Outbox administrativo: sobrevive caídas entre la decisión y el proveedor. */
export const transactionalDeliveries = createTable(
  "transactional_delivery",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    appointmentId: uuid("appointment_id"),
    recipientContactId: uuid("recipient_contact_id"),
    kind: text("kind").$type<TransactionalDeliveryKind>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status")
      .$type<TransactionalDeliveryStatus>()
      .default("pending")
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
    }).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    providerStatus: text(
      "provider_status",
    ).$type<WhatsAppDeliveryStatus | null>(),
    consentReference: text("consent_reference"),
    patientConsentReference: text("patient_consent_reference"),
    consentDecision: text("consent_decision").$type<
      "allowed" | "blocked" | null
    >(),
    consentPrivacyVersion: text("consent_privacy_version"),
    consentTermsVersion: text("consent_terms_version"),
    consentTextReference: text("consent_text_reference"),
    consentAcceptedAt: timestamp("consent_accepted_at", { withTimezone: true }),
    lastError: text("last_error"),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("transactional_delivery_clinic_id_unique").on(
      table.clinicId,
      table.id,
    ),
    uniqueIndex("transactional_delivery_clinic_key_unique").on(
      table.clinicId,
      table.idempotencyKey,
    ),
    index("transactional_delivery_ready_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    check(
      "transactional_delivery_kind",
      sql`${table.kind} IN ('appointment-message', 'appointment-reminder', 'daily-agenda-pdf')`,
    ),
    check(
      "transactional_delivery_status",
      sql`${table.status} IN ('accepted', 'delivered', 'failed', 'pending', 'processing', 'read', 'sent', 'suppressed', 'unknown')`,
    ),
    foreignKey({
      columns: [table.clinicId, table.appointmentId],
      foreignColumns: [appointments.clinicId, appointments.id],
      name: "transactional_delivery_appointment_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.recipientContactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "transactional_delivery_recipient_same_clinic_fk",
    }).onDelete("restrict"),
  ],
);

/** Intentos y callbacks inmutables para auditar una Entrega transaccional. */
export const transactionalDeliveryAttempts = createTable(
  "transactional_delivery_attempt",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    deliveryId: uuid("delivery_id").notNull(),
    attempt: integer("attempt").notNull(),
    outcome: text("outcome")
      .$type<
        | "accepted"
        | "callback"
        | "delivered"
        | "failed"
        | "read"
        | "sent"
        | "unknown"
      >()
      .notNull(),
    providerMessageId: text("provider_message_id"),
    providerEventId: text("provider_event_id"),
    providerStatus: text("provider_status"),
    error: text("error"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("transactional_delivery_callback_unique")
      .on(table.deliveryId, table.providerEventId)
      .where(
        sql`${table.outcome} = 'callback' AND ${table.providerEventId} IS NOT NULL`,
      ),
    check(
      "transactional_delivery_attempt_outcome",
      sql`${table.outcome} IN ('accepted', 'callback', 'delivered', 'failed', 'read', 'sent', 'unknown')`,
    ),
    foreignKey({
      columns: [table.clinicId, table.deliveryId],
      foreignColumns: [
        transactionalDeliveries.clinicId,
        transactionalDeliveries.id,
      ],
      name: "transactional_delivery_attempt_delivery_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Tarea humana visible a cualquier Usuario activo de la Clínica. */
export const transactionalDeliveryAlerts = createTable(
  "transactional_delivery_alert",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    deliveryId: uuid("delivery_id").notNull(),
    priority: text("priority")
      .$type<PendingPriority>()
      .default("high")
      .notNull(),
    resolutionEvidence: text("resolution_evidence"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByClinicUserId: uuid("resolved_by_clinic_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("transactional_delivery_alert_delivery_unique").on(
      table.deliveryId,
    ),
    foreignKey({
      columns: [table.clinicId, table.deliveryId],
      foreignColumns: [
        transactionalDeliveries.clinicId,
        transactionalDeliveries.id,
      ],
      name: "transactional_delivery_alert_delivery_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.resolvedByClinicUserId],
      foreignColumns: [clinicUsers.clinicId, clinicUsers.id],
      name: "transactional_delivery_alert_resolver_same_clinic_fk",
    }).onDelete("restrict"),
    check(
      "transactional_delivery_alert_resolution_evidence",
      sql`${table.resolvedAt} IS NULL OR btrim(coalesce(${table.resolutionEvidence}, '')) <> ''`,
    ),
  ],
);

/** Reserva distribuida de capacidad para respetar cinco envíos por segundo. */
export const whatsappSendRateLimitSlots = createTable(
  "whatsapp_send_rate_limit_slot",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    phoneNumberId: text("phone_number_id").notNull(),
    nextAllowedAt: timestamp("next_allowed_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_send_rate_limit_slot_phone_unique").on(
      table.phoneNumberId,
    ),
  ],
);

export const clinicInvitations = createTable(
  "clinic_invitation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    recipientName: text("recipient_name").notNull(),
    role: text("role").$type<ClinicInvitationRole>().default("owner").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    acceptedIdentityId: text("accepted_identity_id").references(() => user.id, {
      onDelete: "set null",
    }),
    acceptedIdentityCreated: boolean("accepted_identity_created"),
    deliveryAttemptId: uuid("delivery_attempt_id"),
    deliveryLeaseExpiresAt: timestamp("delivery_lease_expires_at", {
      withTimezone: true,
    }),
  },
  (table) => [
    uniqueIndex("clinic_invitation_owner_unique")
      .on(table.clinicId)
      .where(sql`${table.role} = 'owner'`),
  ],
);

/** Historial append-only de cada intento de entrega de una invitación de propietario. */
export const clinicInvitationDeliveries = createTable(
  "clinic_invitation_delivery",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => clinicInvitations.id, { onDelete: "cascade" }),
    actorIdentityId: text("actor_identity_id").references(() => user.id, {
      onDelete: "set null",
    }),
    result: text("result").$type<ClinicInvitationDeliveryResult>().notNull(),
    failureReason: text("failure_reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("clinic_invitation_delivery_clinic_idx").on(
      table.clinicId,
      table.occurredAt,
    ),
    index("clinic_invitation_delivery_invitation_idx").on(
      table.invitationId,
      table.occurredAt,
    ),
    check(
      "clinic_invitation_delivery_result",
      sql`${table.result} IN ('failed', 'succeeded')`,
    ),
    check(
      "clinic_invitation_delivery_failure_reason",
      sql`${table.result} = 'succeeded' OR NULLIF(btrim(${table.failureReason}), '') IS NOT NULL`,
    ),
  ],
);

/** Un secreto opaco por navegador; nunca se almacena el valor enviado al cliente. */
export const trustedClinicDevices = createTable(
  "trusted_clinic_device",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: text("identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("trusted_clinic_device_identity_idx").on(table.identityId)],
);

/** Sesión clínica efímera, emitida únicamente tras validar el dispositivo. */
export const clinicSessions = createTable(
  "clinic_session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: text("identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("clinic_session_identity_idx").on(table.identityId)],
);

/** Titular de un número de WhatsApp dentro de una Clínica. */
export const contacts = createTable(
  "contact",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // A Contacto can be resolved by WhatsApp BSUID before Meta reveals a phone.
    phoneE164: text("phone_e164"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("contact_clinic_id_unique").on(table.clinicId, table.id),
    uniqueIndex("contact_clinic_phone_e164_unique").on(
      table.clinicId,
      table.phoneE164,
    ),
    index("contact_clinic_idx").on(table.clinicId),
    index("contact_clinic_name_idx").on(table.clinicId, table.name),
  ],
);

/** Snapshot histórico de una identidad de WhatsApp dentro de una Clínica. */
export const whatsappIdentities = createTable(
  "whatsapp_identity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id"),
    phoneNumberId: text("phone_number_id").notNull(),
    waId: text("wa_id"),
    phoneE164: text("phone_e164"),
    businessScopedUserId: text("business_scoped_user_id"),
    parentBusinessScopedUserId: text("parent_business_scoped_user_id"),
    username: text("username"),
    status: text("status").$type<WhatsAppIdentityStatus>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    sourceMessageId: text("source_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("whatsapp_identity_clinic_id_unique").on(table.clinicId, table.id),
    uniqueIndex("whatsapp_identity_clinic_contact_id_unique").on(
      table.clinicId,
      table.contactId,
      table.id,
    ),
    index("whatsapp_identity_clinic_contact_idx").on(
      table.clinicId,
      table.contactId,
    ),
    index("whatsapp_identity_lookup_idx").on(
      table.clinicId,
      table.phoneNumberId,
      table.businessScopedUserId,
      table.phoneE164,
    ),
    uniqueIndex("whatsapp_identity_active_bsuid_unique")
      .on(table.clinicId, table.phoneNumberId, table.businessScopedUserId)
      .where(
        sql`${table.status} = 'active' AND ${table.businessScopedUserId} IS NOT NULL`,
      ),
    uniqueIndex("whatsapp_identity_active_phone_unique")
      .on(table.clinicId, table.phoneNumberId, table.phoneE164)
      .where(
        sql`${table.status} = 'active' AND ${table.phoneE164} IS NOT NULL`,
      ),
    foreignKey({
      columns: [table.clinicId, table.contactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "whatsapp_identity_contact_same_clinic_fk",
    }).onDelete("restrict"),
    check(
      "whatsapp_identity_status",
      sql`${table.status} IN ('active', 'historical', 'conflict', 'unresolved')`,
    ),
  ],
);

/** Cola durable y auditable de mensajes Kapso antes de despertar Asclepio. */
export const whatsappInboundMessages = createTable(
  "whatsapp_inbound_message",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    eventName: text("event_name").notNull(),
    messageId: text("message_id").notNull(),
    batchFirstSequence: integer("batch_first_sequence"),
    batchSequence: integer("batch_sequence"),
    phoneNumberId: text("phone_number_id").notNull(),
    conversationId: text("conversation_id"),
    customerId: text("customer_id"),
    direction: text("direction")
      .$type<"inbound" | "outbound" | "unknown">()
      .notNull(),
    origin: text("origin")
      .$type<"cloud_api" | "business_app" | "history_sync" | "unknown">()
      .notNull(),
    type: text("type").notNull(),
    text: text("text"),
    interactiveAction: text("interactive_action").$type<"continue">(),
    fromWaId: text("from_wa_id"),
    phoneE164: text("phone_e164"),
    businessScopedUserId: text("business_scoped_user_id"),
    parentBusinessScopedUserId: text("parent_business_scoped_user_id"),
    username: text("username"),
    messageTimestamp: timestamp("message_timestamp", { withTimezone: true }),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull(),
    clinicId: uuid("clinic_id"),
    contactId: uuid("contact_id"),
    identityId: uuid("identity_id"),
    assistantResponseText: text("assistant_response_text"),
    status: text("status")
      .$type<
        | "awaiting-consent"
        | "conflict"
        | "ignored"
        | "pending"
        | "processed"
        | "processing"
        | "rejected"
      >()
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    consentReference: text("consent_reference"),
    serviceWindowExpiresAt: timestamp("service_window_expires_at", {
      withTimezone: true,
    }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("whatsapp_inbound_message_idempotency_unique").on(
      sql`coalesce(${table.customerId}, '')`,
      table.idempotencyKey,
    ),
    uniqueIndex("whatsapp_inbound_message_message_unique").on(
      sql`coalesce(${table.customerId}, '')`,
      table.phoneNumberId,
      table.messageId,
    ),
    index("whatsapp_inbound_message_claim_idx").on(
      table.status,
      table.nextAttemptAt,
      table.receivedAt,
      table.batchSequence,
    ),
    index("whatsapp_inbound_message_conversation_idx").on(
      table.clinicId,
      table.conversationId,
      table.receivedAt,
    ),
    index("whatsapp_inbound_message_identity_idx").on(
      table.clinicId,
      table.contactId,
      table.receivedAt,
    ),
    foreignKey({
      columns: [table.clinicId, table.contactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "whatsapp_inbound_message_contact_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId, table.identityId],
      foreignColumns: [whatsappIdentities.clinicId, whatsappIdentities.id],
      name: "whatsapp_inbound_message_identity_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId],
      foreignColumns: [clinics.id],
      name: "whatsapp_inbound_message_clinic_fk",
    }).onDelete("cascade"),
    check(
      "whatsapp_inbound_message_event_name",
      sql`${table.eventName} IN ('whatsapp.message.received', 'whatsapp.message.sent')`,
    ),
    check(
      "whatsapp_inbound_message_batch_order",
      sql`(${table.batchFirstSequence} IS NULL AND ${table.batchSequence} IS NULL)
        OR (${table.batchFirstSequence} IS NOT NULL
          AND ${table.batchSequence} IS NOT NULL
          AND ${table.batchSequence} >= ${table.batchFirstSequence})`,
    ),
    check(
      "whatsapp_inbound_message_status",
      sql`${table.status} IN ('awaiting-consent', 'conflict', 'ignored', 'pending', 'processed', 'processing', 'rejected')`,
    ),
    check(
      "whatsapp_inbound_message_direction",
      sql`${table.direction} IN ('inbound', 'outbound', 'unknown')`,
    ),
    check(
      "whatsapp_inbound_message_origin",
      sql`${table.origin} IN ('cloud_api', 'business_app', 'history_sync', 'unknown')`,
    ),
    check(
      "whatsapp_inbound_message_interactive_action",
      sql`${table.interactiveAction} IS NULL OR ${table.interactiveAction} = 'continue'`,
    ),
  ],
);

/** Alerta global de Apolo para eventos inbound que no pueden cruzarse con una Clínica. */
export const whatsappInboundAlerts = createTable(
  "whatsapp_inbound_alert",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    inboundMessageId: uuid("inbound_message_id")
      .notNull()
      .references(() => whatsappInboundMessages.id, { onDelete: "cascade" }),
    phoneNumberId: text("phone_number_id").notNull(),
    customerId: text("customer_id"),
    reason: text("reason").notNull(),
    nextAction: text("next_action").notNull(),
    status: text("status")
      .$type<WhatsAppInboundAlertStatus>()
      .default("open")
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByIdentityId: text("resolved_by_identity_id").references(
      () => user.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_inbound_alert_message_unique").on(
      table.inboundMessageId,
    ),
    index("whatsapp_inbound_alert_status_idx").on(
      table.status,
      table.updatedAt,
    ),
    check(
      "whatsapp_inbound_alert_reason_not_blank",
      sql`btrim(${table.reason}) <> ''`,
    ),
    check(
      "whatsapp_inbound_alert_next_action_not_blank",
      sql`btrim(${table.nextAction}) <> ''`,
    ),
    check(
      "whatsapp_inbound_alert_status",
      sql`${table.status} IN ('open', 'resolved')`,
    ),
    check(
      "whatsapp_inbound_alert_resolution",
      sql`${table.status} = 'open' OR ${table.resolvedAt} IS NOT NULL`,
    ),
  ],
);

export type WhatsAppInboundReplyStatus =
  | "accepted"
  | "delivered"
  | "failed"
  | "pending"
  | "processing"
  | "read"
  | "sent"
  | "unknown";

/** Outbox durable de respuestas inbound; APO-89 podrá drenarlo hacia Kapso. */
export const whatsappInboundReplies = createTable(
  "whatsapp_inbound_reply",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    recipientBusinessScopedUserId: text("recipient_business_scoped_user_id"),
    recipientPhoneE164: text("recipient_phone_e164"),
    buttonLabel: text("button_label"),
    text: text("text").notNull(),
    status: text("status")
      .$type<WhatsAppInboundReplyStatus>()
      .default("pending")
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    serviceWindowExpiresAt: timestamp("service_window_expires_at", {
      withTimezone: true,
    }),
    providerMessageId: text("provider_message_id"),
    lastProviderEventId: text("last_provider_event_id"),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("whatsapp_inbound_reply_clinic_id_unique").on(
      table.clinicId,
      table.id,
    ),
    uniqueIndex("whatsapp_inbound_reply_idempotency_unique").on(
      table.clinicId,
      table.idempotencyKey,
    ),
    index("whatsapp_inbound_reply_ready_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    check(
      "whatsapp_inbound_reply_recipient",
      sql`${table.recipientBusinessScopedUserId} IS NOT NULL OR ${table.recipientPhoneE164} IS NOT NULL`,
    ),
    check(
      "whatsapp_inbound_reply_status",
      sql`${table.status} IN ('accepted', 'delivered', 'failed', 'pending', 'processing', 'read', 'sent', 'unknown')`,
    ),
  ],
);

/** Lease distribuido por conversación para serializar efectos de Asclepio. */
export const whatsappConversationLocks = createTable(
  "whatsapp_conversation_lock",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull(),
    ownerToken: text("owner_token").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("whatsapp_conversation_lock_clinic_id_unique").on(
      table.clinicId,
      table.id,
    ),
    uniqueIndex("whatsapp_conversation_lock_key_unique").on(
      table.clinicId,
      table.conversationId,
    ),
    index("whatsapp_conversation_lock_expiry_idx").on(table.leaseExpiresAt),
  ],
);

/** Persona para quien se gestiona una Cita, sin identidad compartida entre Clínicas. */
export const patients = createTable(
  "patient",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Las fichas previas a APO-38 no tenían fecha; al editarlas se completa. */
    birthDate: date("birth_date", { mode: "string" }),
    dui: text("dui"),
    registrationMessageId: text("registration_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("patient_clinic_id_unique").on(table.clinicId, table.id),
    uniqueIndex("patient_clinic_registration_message_unique")
      .on(table.clinicId, table.registrationMessageId)
      .where(sql`${table.registrationMessageId} IS NOT NULL`),
    index("patient_clinic_idx").on(table.clinicId),
    index("patient_clinic_name_idx").on(table.clinicId, table.name),
  ],
);

/** Relación explícita entre un Contacto y un Paciente de la misma Clínica. */
export const contactPatientLinks = createTable(
  "contact_patient_link",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    relationship: text("relationship").notNull().default("contact"),
    guardianDui: text("guardian_dui"),
    guardianDeclaration: text("guardian_declaration"),
    guardianshipVerificationStatus: text("guardianship_verification_status"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("contact_patient_link_unique").on(
      table.contactId,
      table.patientId,
    ),
    index("contact_patient_link_contact_idx").on(table.contactId),
    index("contact_patient_link_patient_idx").on(table.patientId),
    index("contact_patient_link_guardianship_idx").on(
      table.clinicId,
      table.relationship,
      table.guardianshipVerificationStatus,
    ),
    foreignKey({
      columns: [table.clinicId, table.contactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "contact_patient_link_contact_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: "contact_patient_link_patient_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Evidencia append-only de consentimiento por Contacto y su historial legado. */
export const whatsappContactConsents = createTable(
  "whatsapp_contact_consent",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    identityId: uuid("identity_id").notNull(),
    patientId: uuid("patient_id"),
    phoneE164: text("phone_e164"),
    declaration: text("declaration").notNull(),
    scope: text("scope").$type<WhatsAppConsentScope>().notNull(),
    acceptedRole: text("accepted_role")
      .$type<WhatsAppConsentAcceptedRole>()
      .notNull(),
    privacyVersion: text("privacy_version").notNull(),
    termsVersion: text("terms_version").notNull(),
    textReference: text("text_reference").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    provider: text("provider").$type<"kapso">().notNull(),
    interactionId: text("interaction_id").notNull(),
    status: text("status")
      .$type<WhatsAppConsentStatus>()
      .default("accepted")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_contact_consent_interaction_unique").on(
      table.clinicId,
      table.provider,
      table.interactionId,
    ),
    index("whatsapp_contact_consent_current_idx").on(
      table.clinicId,
      table.contactId,
      table.scope,
      table.acceptedAt,
    ),
    foreignKey({
      columns: [table.clinicId, table.contactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "whatsapp_contact_consent_contact_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId, table.contactId, table.identityId],
      foreignColumns: [
        whatsappIdentities.clinicId,
        whatsappIdentities.contactId,
        whatsappIdentities.id,
      ],
      name: "whatsapp_contact_consent_identity_contact_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: "whatsapp_contact_consent_patient_same_clinic_fk",
    }).onDelete("restrict"),
    check(
      "whatsapp_contact_consent_scope",
      sql`(
        (${table.scope} = 'contact' AND ${table.patientId} IS NULL)
        OR (${table.scope} = 'patient' AND ${table.patientId} IS NOT NULL)
      )`,
    ),
    check(
      "whatsapp_contact_consent_role",
      sql`${table.acceptedRole} IN ('adult-patient', 'contact', 'tutor')`,
    ),
    check(
      "whatsapp_contact_consent_provider",
      sql`${table.provider} = 'kapso'`,
    ),
    check(
      "whatsapp_contact_consent_status",
      sql`${table.status} IN ('accepted', 'revoked')`,
    ),
    check(
      "whatsapp_contact_consent_reference",
      sql`btrim(${table.textReference}) <> ''`,
    ),
    check(
      "whatsapp_contact_consent_declaration",
      sql`btrim(${table.declaration}) <> ''`,
    ),
    check(
      "whatsapp_contact_consent_interaction",
      sql`btrim(${table.interactionId}) <> ''`,
    ),
  ],
);

/** Estado administrativo, no clínico, del diálogo de Asclepio. */
export const whatsappConversations = createTable(
  "whatsapp_conversation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    state: jsonb("state").$type<BookingConversation>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_conversation_contact_unique").on(
      table.clinicId,
      table.contactId,
    ),
    foreignKey({
      columns: [table.clinicId, table.contactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "whatsapp_conversation_contact_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Tarea de atención humana que detiene el diálogo administrativo de Asclepio. */
export const conversationEscalations = createTable(
  "conversation_escalation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    trigger: text("trigger").$type<ConversationEscalationTrigger>().notNull(),
    sourceMessageId: text("source_message_id"),
    sourceMessageType: text("source_message_type"),
    notificationSentAt: timestamp("notification_sent_at", {
      withTimezone: true,
    }),
    priority: text("priority")
      .$type<PendingPriority>()
      .default("high")
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByClinicUserId: uuid("resolved_by_clinic_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("conversation_escalation_clinic_idx").on(
      table.clinicId,
      table.createdAt,
    ),
    check(
      "pg-drizzle_conversation_escalation_trigger_check",
      sql`${table.trigger} IN (
        'business-app',
        'human-request',
        'frustration',
        'misunderstanding',
        'voice-transcription-disabled',
        'voice-transcription-failed',
        'guardianship-pending',
        'unsupported-message'
      )`,
    ),
    uniqueIndex("conversation_escalation_source_message_unique")
      .on(table.clinicId, table.sourceMessageId)
      .where(sql`${table.sourceMessageId} IS NOT NULL`),
    foreignKey({
      columns: [table.clinicId, table.contactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "conversation_escalation_contact_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId, table.resolvedByClinicUserId],
      foreignColumns: [clinicUsers.clinicId, clinicUsers.id],
      name: "conversation_escalation_resolver_same_clinic_fk",
    }).onDelete("restrict"),
  ],
);

/** Registro administrativo del Protocolo de urgencia, sin contenido clínico. */
export const conversationEvents = createTable(
  "conversation_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    type: text("type").$type<"urgency-protocol">().notNull(),
    sourceMessageId: text("source_message_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("conversation_event_clinic_idx").on(table.clinicId, table.occurredAt),
    uniqueIndex("conversation_event_source_message_unique")
      .on(table.clinicId, table.sourceMessageId)
      .where(sql`${table.sourceMessageId} IS NOT NULL`),
    foreignKey({
      columns: [table.clinicId, table.contactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "conversation_event_contact_same_clinic_fk",
    }).onDelete("restrict"),
  ],
);

/** Cada entrega del adaptador simulado conserva su respuesta para idempotencia. */
export const simulatedWhatsAppMessages = createTable(
  "simulated_whatsapp_message",
  {
    id: text("id").primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    origin: text("origin")
      .$type<WhatsAppMessageOrigin>()
      .default("text")
      .notNull(),
    response: jsonb("response").$type<WhatsAppBookingResponse>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("simulated_whatsapp_message_clinic_idx").on(table.clinicId),
    foreignKey({
      columns: [table.clinicId, table.contactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "simulated_whatsapp_message_contact_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

export const identityAuditEvents = createTable("identity_audit_event", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id").references(() => clinics.id, {
    onDelete: "set null",
  }),
  actorIdentityId: text("actor_identity_id").references(() => user.id, {
    onDelete: "set null",
  }),
  actorKind: text("actor_kind")
    .$type<"anonymous" | "identity">()
    .default("identity")
    .notNull(),
  action: text("action").notNull(),
  result: text("result").$type<"failed" | "succeeded" | "unknown">().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Intento fallido de contraseña; cinco en 15 minutos bloquean temporalmente la Identidad. */
export const identityLoginFailures = createTable(
  "identity_login_failure",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: text("identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    failedAt: timestamp("failed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("identity_login_failure_identity_idx").on(
      table.identityId,
      table.failedAt,
    ),
  ],
);

/** Solicitud de restablecimiento por IP dentro de una ventana deslizante de 15 minutos. */
export const identityRecoveryRequests = createTable(
  "identity_recovery_request",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ipHash: text("ip_hash").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("identity_recovery_request_ip_idx").on(
      table.ipHash,
      table.requestedAt,
    ),
  ],
);

/** Intentos anónimos de demo; conserva solo hashes para aplicar rate limits. */
export const demoRequestRateLimitAttempts = createTable(
  "demo_request_rate_limit_attempt",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scope: text("scope").$type<DemoRequestRateLimitScope>().notNull(),
    keyHash: text("key_hash").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("demo_request_rate_limit_scope_key_idx").on(
      table.scope,
      table.keyHash,
      table.requestedAt,
    ),
  ],
);

/** Auditoría de capacidad clínica; nunca almacena datos de Pacientes. */
export const configurationAuditEvents = createTable(
  "configuration_audit_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    /** Identificadores inmutables para conservar evidencia durante la retención. */
    actorIdentityId: text("actor_identity_id").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    beforeValues: jsonb("before_values").$type<Record<string, string | null>>(),
    afterValues: jsonb("after_values")
      .$type<Record<string, string | null>>()
      .notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("configuration_audit_clinic_idx").on(table.clinicId)],
);

/** Operadores de Apolo: identidad separada de cualquier rol clínico. */
export const apoloSuperadmins = createTable("superadmin", {
  identityId: text("identity_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Pago comercial manual; no concede contexto ni permisos clínicos. */
export const transferPayments = createTable(
  "transfer_payment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    operationKey: text("operation_key").notNull(),
    amountUsd: numeric("amount_usd", { precision: 12, scale: 2 }).notNull(),
    reference: text("reference").notNull(),
    recordedByIdentityId: text("recorded_by_identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("transfer_payment_clinic_idx").on(table.clinicId),
    uniqueIndex("transfer_payment_operation_key_unique").on(table.operationKey),
  ],
);

/** Impersonación de soporte explícita, limitada a una Clínica y vencible. */
export const clinicSupportSessions = createTable(
  "clinic_support_session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    operationKey: text("operation_key").notNull(),
    superadminIdentityId: text("superadmin_identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("clinic_support_session_clinic_idx").on(
      table.clinicId,
      table.expiresAt,
    ),
    uniqueIndex("clinic_support_session_operation_key_unique").on(
      table.operationKey,
    ),
  ],
);

/** Evidencia append-only de cada acceso de soporte a una Clínica. */
export const apoloAuditEvents = createTable(
  "apolo_audit_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    operationKey: text("operation_key"),
    actorIdentityId: text("actor_identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    supportSessionId: uuid("support_session_id").references(
      () => clinicSupportSessions.id,
      { onDelete: "restrict" },
    ),
    action: text("action").notNull(),
    subscriptionStatus: text("subscription_status").$type<SubscriptionStatus>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("apolo_audit_event_clinic_idx").on(table.clinicId),
    uniqueIndex("apolo_audit_event_operation_key_unique").on(
      table.operationKey,
    ),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  account: many(account),
  session: many(session),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));
