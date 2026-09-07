CREATE TABLE "pg-drizzle_whatsapp_setup_link" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "customer_id" text NOT NULL,
  "kapso_setup_link_id" text NOT NULL,
  "url" text NOT NULL,
  "provider_status" text,
  "provider_error" text,
  "status" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "used_at" timestamp with time zone,
  "created_by_identity_id" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_setup_link_status"
    CHECK ("status" IN ('active', 'used', 'expired', 'revoked')),
  CONSTRAINT "whatsapp_setup_link_customer_not_blank"
    CHECK (btrim("customer_id") <> ''),
  CONSTRAINT "whatsapp_setup_link_kapso_id_not_blank"
    CHECK (btrim("kapso_setup_link_id") <> ''),
  CONSTRAINT "whatsapp_setup_link_provider_status"
    CHECK ("provider_status" IS NULL OR "provider_status" IN ('pending', 'completed', 'failed', 'unknown')),
  CONSTRAINT "whatsapp_setup_link_url_https"
    CHECK ("url" ~ '^https://'),
  CONSTRAINT "whatsapp_setup_link_expiry_after_creation"
    CHECK ("expires_at" = "created_at" + INTERVAL '30 days'),
  CONSTRAINT "whatsapp_setup_link_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "pg-drizzle_clinic" ("id")
    ON DELETE cascade,
  CONSTRAINT "whatsapp_setup_link_creator_fk"
    FOREIGN KEY ("created_by_identity_id")
    REFERENCES "user" ("id")
    ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX "whatsapp_setup_link_clinic_idx"
  ON "pg-drizzle_whatsapp_setup_link" USING btree ("clinic_id", "created_at");
CREATE INDEX "whatsapp_setup_link_customer_idx"
  ON "pg-drizzle_whatsapp_setup_link" USING btree ("customer_id");
CREATE UNIQUE INDEX "whatsapp_setup_link_kapso_id_unique"
  ON "pg-drizzle_whatsapp_setup_link" USING btree ("kapso_setup_link_id");
CREATE UNIQUE INDEX "whatsapp_setup_link_active_customer_unique"
  ON "pg-drizzle_whatsapp_setup_link" USING btree ("customer_id")
  WHERE "status" = 'active';
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_setup_link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_setup_link" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE
  ON TABLE "pg-drizzle_whatsapp_setup_link"
  TO panacea_clinical_access;
--> statement-breakpoint
CREATE POLICY "whatsapp_setup_link_superadmin_manage"
  ON "pg-drizzle_whatsapp_setup_link"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_setup_link_clinic_owner_read"
  ON "pg-drizzle_whatsapp_setup_link"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
CREATE POLICY "whatsapp_setup_link_clinic_owner_insert"
  ON "pg-drizzle_whatsapp_setup_link"
  FOR INSERT
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
    AND "created_by_identity_id" = NULLIF(current_setting('app.identity_id', true), '')
    AND EXISTS (
      SELECT 1
      FROM "pg-drizzle_whatsapp_preflight" AS preflight
      WHERE preflight."clinic_id" = "pg-drizzle_whatsapp_setup_link"."clinic_id"
        AND preflight."customer_id" = "pg-drizzle_whatsapp_setup_link"."customer_id"
        AND preflight."status" = 'passed'
    )
  );
CREATE POLICY "whatsapp_setup_link_clinic_owner_update"
  ON "pg-drizzle_whatsapp_setup_link"
  FOR UPDATE
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
    AND EXISTS (
      SELECT 1
      FROM "pg-drizzle_whatsapp_preflight" AS preflight
      WHERE preflight."clinic_id" = "pg-drizzle_whatsapp_setup_link"."clinic_id"
        AND preflight."customer_id" = "pg-drizzle_whatsapp_setup_link"."customer_id"
        AND preflight."status" = 'passed'
    )
  )
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
    AND EXISTS (
      SELECT 1
      FROM "pg-drizzle_whatsapp_preflight" AS preflight
      WHERE preflight."clinic_id" = "pg-drizzle_whatsapp_setup_link"."clinic_id"
        AND preflight."customer_id" = "pg-drizzle_whatsapp_setup_link"."customer_id"
        AND preflight."status" = 'passed'
    )
  );
CREATE POLICY "whatsapp_setup_link_subscription_active_read"
  ON "pg-drizzle_whatsapp_setup_link"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
CREATE POLICY "whatsapp_setup_link_subscription_active_insert"
  ON "pg-drizzle_whatsapp_setup_link"
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    current_setting('app.subscription_status', true) = 'active'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
CREATE POLICY "whatsapp_setup_link_subscription_active_update"
  ON "pg-drizzle_whatsapp_setup_link"
  AS RESTRICTIVE
  FOR UPDATE
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  )
  WITH CHECK (
    current_setting('app.subscription_status', true) = 'active'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_onboarding_audit_event"
  ADD COLUMN "setup_link_id" text;
CREATE INDEX "whatsapp_onboarding_audit_setup_link_idx"
  ON "pg-drizzle_whatsapp_onboarding_audit_event" USING btree ("setup_link_id");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_onboarding_audit_event"
  DROP CONSTRAINT "whatsapp_onboarding_audit_action";
ALTER TABLE "pg-drizzle_whatsapp_onboarding_audit_event"
  ADD CONSTRAINT "whatsapp_onboarding_audit_action"
  CHECK (
    "action" IN (
      'customer-confirmed',
      'customer-created',
      'onboarding-provider-unavailable',
      'preflight-executed',
      'setup-link-confirmed',
      'setup-link-created',
      'setup-link-expired',
      'setup-link-provider-unavailable',
      'setup-link-regenerated',
      'setup-link-revoked',
      'setup-link-used'
    )
  );
--> statement-breakpoint
GRANT INSERT ON TABLE "pg-drizzle_whatsapp_onboarding_audit_event"
  TO panacea_clinical_access;
CREATE POLICY "whatsapp_onboarding_audit_clinic_owner_insert"
  ON "pg-drizzle_whatsapp_onboarding_audit_event"
  FOR INSERT
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
    AND "actor_identity_id" = NULLIF(current_setting('app.identity_id', true), '')
    AND current_setting('app.subscription_status', true) = 'active'
  );
