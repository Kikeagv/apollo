ALTER TABLE "pg-drizzle_whatsapp_provisioning_step"
  ADD COLUMN "project_id" text;
--> statement-breakpoint
CREATE INDEX "whatsapp_provisioning_step_generation_idx"
  ON "pg-drizzle_whatsapp_provisioning_step"
  USING btree ("clinic_id", "phone_number_id", "project_id", "updated_at");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_readiness" (
  "clinic_id" uuid PRIMARY KEY NOT NULL,
  "phone_number_id" text,
  "business_account_id" text,
  "project_id" text,
  "provisioning_event_id" uuid,
  "revision" integer DEFAULT 0 NOT NULL,
  "number_environment" text DEFAULT 'unknown' NOT NULL,
  "number_health" text DEFAULT 'unknown' NOT NULL,
  "number_health_checked_at" timestamp with time zone,
  "project_webhook_status" text DEFAULT 'pending' NOT NULL,
  "project_webhook_id" text,
  "project_webhook_last_attempt_at" timestamp with time zone,
  "project_webhook_last_error" text,
  "phone_number_webhook_status" text DEFAULT 'pending' NOT NULL,
  "phone_number_webhook_id" text,
  "phone_number_webhook_last_attempt_at" timestamp with time zone,
  "phone_number_webhook_last_error" text,
  "templates_sync_status" text DEFAULT 'pending' NOT NULL,
  "templates_sync_last_synced_at" timestamp with time zone,
  "templates_sync_last_error" text,
  "billing_sync_status" text DEFAULT 'pending' NOT NULL,
  "billing_sync_last_synced_at" timestamp with time zone,
  "billing_sync_last_error" text,
  "e2e_status" text DEFAULT 'pending' NOT NULL,
  "e2e_evidence_scope" text,
  "e2e_evidence" text,
  "e2e_last_test_at" timestamp with time zone,
  "e2e_last_error" text,
  "technical_status" text DEFAULT 'pending' NOT NULL,
  "next_action" text,
  "status_reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_readiness_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "pg-drizzle_clinic" ("id")
    ON DELETE cascade,
  CONSTRAINT "whatsapp_readiness_number_environment"
    CHECK ("number_environment" IN ('production', 'sandbox', 'unknown')),
  CONSTRAINT "whatsapp_readiness_number_health"
    CHECK ("number_health" IN ('healthy', 'degraded', 'unhealthy', 'error', 'unknown')),
  CONSTRAINT "whatsapp_readiness_project_webhook_status"
    CHECK ("project_webhook_status" IN ('ready', 'pending', 'failed')),
  CONSTRAINT "whatsapp_readiness_phone_webhook_status"
    CHECK ("phone_number_webhook_status" IN ('ready', 'pending', 'failed')),
  CONSTRAINT "whatsapp_readiness_templates_sync_status"
    CHECK ("templates_sync_status" IN ('ready', 'pending', 'failed')),
  CONSTRAINT "whatsapp_readiness_billing_sync_status"
    CHECK ("billing_sync_status" IN ('ready', 'pending', 'failed')),
  CONSTRAINT "whatsapp_readiness_e2e_status"
    CHECK ("e2e_status" IN ('passed', 'pending', 'failed')),
  CONSTRAINT "whatsapp_readiness_e2e_evidence_scope"
    CHECK ("e2e_evidence_scope" IS NULL OR "e2e_evidence_scope" IN ('message-roundtrip', 'webhook-preflight')),
  CONSTRAINT "whatsapp_readiness_technical_status"
    CHECK ("technical_status" IN ('pending', 'ready', 'degraded', 'blocked')),
  CONSTRAINT "whatsapp_readiness_revision_non_negative"
    CHECK ("revision" >= 0),
  CONSTRAINT "whatsapp_readiness_status_reason_not_blank"
    CHECK (btrim("status_reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_critical_template" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "project_id" text,
  "provisioning_event_id" uuid,
  "kind" text NOT NULL,
  "category" text,
  "provider_template_id" text,
  "name" text NOT NULL,
  "locale" text NOT NULL,
  "variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text NOT NULL,
  "rejection_reason" text,
  "synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_critical_template_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "pg-drizzle_clinic" ("id")
    ON DELETE cascade,
  CONSTRAINT "whatsapp_critical_template_kind"
    CHECK ("kind" IN ('confirmation', 'reminder', 'cancellation', 'reschedule')),
  CONSTRAINT "whatsapp_critical_template_category"
    CHECK ("category" IS NULL OR "category" IN ('AUTHENTICATION', 'MARKETING', 'UTILITY')),
  CONSTRAINT "whatsapp_critical_template_status"
    CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'DISABLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_critical_template_clinic_kind_unique"
  ON "pg-drizzle_whatsapp_critical_template" USING btree ("clinic_id", "kind");
CREATE INDEX "whatsapp_critical_template_clinic_idx"
  ON "pg-drizzle_whatsapp_critical_template" USING btree ("clinic_id");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_billing" (
  "clinic_id" uuid PRIMARY KEY NOT NULL,
  "mode" text DEFAULT 'unknown' NOT NULL,
  "credit_cents" integer DEFAULT 0 NOT NULL,
  "consumed_cents" integer DEFAULT 0 NOT NULL,
  "alert_threshold_cents" integer,
  "meta_charges_cents" integer,
  "platform_charges_cents" integer,
  "charges_separated" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "last_synced_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_billing_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "pg-drizzle_clinic" ("id")
    ON DELETE cascade,
  CONSTRAINT "whatsapp_billing_mode"
    CHECK ("mode" IN ('partner_managed', 'customer_managed', 'unknown')),
  CONSTRAINT "whatsapp_billing_status"
    CHECK ("status" IN ('ready', 'pending', 'failed')),
  CONSTRAINT "whatsapp_billing_non_negative"
    CHECK ("credit_cents" >= 0 AND "consumed_cents" >= 0),
  CONSTRAINT "whatsapp_billing_alert_threshold_non_negative"
    CHECK ("alert_threshold_cents" IS NULL OR "alert_threshold_cents" >= 0),
  CONSTRAINT "whatsapp_billing_charges_non_negative"
    CHECK (("meta_charges_cents" IS NULL OR "meta_charges_cents" >= 0) AND ("platform_charges_cents" IS NULL OR "platform_charges_cents" >= 0))
);
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_readiness" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_readiness" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_critical_template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_critical_template" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_billing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_billing" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE
    "pg-drizzle_whatsapp_readiness",
    "pg-drizzle_whatsapp_critical_template",
    "pg-drizzle_whatsapp_billing"
  TO panacea_clinical_access;
--> statement-breakpoint
CREATE POLICY "whatsapp_readiness_superadmin_manage"
  ON "pg-drizzle_whatsapp_readiness"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_readiness_clinic_owner_read"
  ON "pg-drizzle_whatsapp_readiness"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
CREATE POLICY "whatsapp_readiness_provider_read"
  ON "pg-drizzle_whatsapp_readiness"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_provider', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
CREATE POLICY "whatsapp_readiness_subscription_active_read"
  ON "pg-drizzle_whatsapp_readiness"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_critical_template_superadmin_manage"
  ON "pg-drizzle_whatsapp_critical_template"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_critical_template_clinic_owner_read"
  ON "pg-drizzle_whatsapp_critical_template"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
CREATE POLICY "whatsapp_critical_template_provider_read"
  ON "pg-drizzle_whatsapp_critical_template"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_provider', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
CREATE POLICY "whatsapp_critical_template_subscription_active_read"
  ON "pg-drizzle_whatsapp_critical_template"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_billing_superadmin_manage"
  ON "pg-drizzle_whatsapp_billing"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_billing_clinic_owner_read"
  ON "pg-drizzle_whatsapp_billing"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
CREATE POLICY "whatsapp_billing_provider_read"
  ON "pg-drizzle_whatsapp_billing"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_provider', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
CREATE POLICY "whatsapp_billing_subscription_active_read"
  ON "pg-drizzle_whatsapp_billing"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
