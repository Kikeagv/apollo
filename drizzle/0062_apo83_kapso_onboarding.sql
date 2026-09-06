CREATE TABLE "pg-drizzle_whatsapp_preflight" (
  "clinic_id" uuid PRIMARY KEY NOT NULL,
  "customer_id" text,
  "status" text DEFAULT 'not-run' NOT NULL,
  "checks" jsonb,
  "blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "next_action" text NOT NULL,
  "reason" text,
  "checked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_preflight_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "pg-drizzle_clinic" ("id")
    ON DELETE cascade,
  CONSTRAINT "whatsapp_preflight_status"
    CHECK ("status" IN ('not-run', 'passed', 'blocked', 'unavailable'))
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_onboarding_audit_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "actor_identity_id" text NOT NULL,
  "customer_id" text,
  "action" text NOT NULL,
  "result" text NOT NULL,
  "reason" text NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_onboarding_audit_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "pg-drizzle_clinic" ("id")
    ON DELETE restrict,
  CONSTRAINT "whatsapp_onboarding_audit_actor_fk"
    FOREIGN KEY ("actor_identity_id")
    REFERENCES "user" ("id")
    ON DELETE restrict,
  CONSTRAINT "whatsapp_onboarding_audit_action"
    CHECK ("action" IN ('customer-confirmed', 'customer-created', 'onboarding-provider-unavailable', 'preflight-executed')),
  CONSTRAINT "whatsapp_onboarding_audit_result"
    CHECK ("result" IN ('blocked', 'failed', 'succeeded')),
  CONSTRAINT "whatsapp_onboarding_audit_reason_not_blank"
    CHECK (btrim("reason") <> '')
);
--> statement-breakpoint
CREATE INDEX "whatsapp_preflight_customer_idx"
  ON "pg-drizzle_whatsapp_preflight" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX "whatsapp_onboarding_audit_clinic_idx"
  ON "pg-drizzle_whatsapp_onboarding_audit_event" USING btree ("clinic_id", "occurred_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_preflight" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_preflight" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_onboarding_audit_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_onboarding_audit_event" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON TABLE "pg-drizzle_whatsapp_preflight"
  TO panacea_clinical_access;
GRANT SELECT ON TABLE "pg-drizzle_whatsapp_onboarding_audit_event"
  TO panacea_clinical_access;
--> statement-breakpoint
CREATE POLICY "whatsapp_preflight_superadmin_manage"
  ON "pg-drizzle_whatsapp_preflight"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_preflight_clinic_owner_read"
  ON "pg-drizzle_whatsapp_preflight"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
CREATE POLICY "whatsapp_preflight_subscription_active_read"
  ON "pg-drizzle_whatsapp_preflight"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_onboarding_audit_superadmin_read"
  ON "pg-drizzle_whatsapp_onboarding_audit_event"
  FOR SELECT
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_onboarding_audit_superadmin_insert"
  ON "pg-drizzle_whatsapp_onboarding_audit_event"
  FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    AND "actor_identity_id" = NULLIF(current_setting('app.superadmin_id', true), '')
  );
CREATE POLICY "whatsapp_onboarding_audit_clinic_owner_read"
  ON "pg-drizzle_whatsapp_onboarding_audit_event"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
CREATE POLICY "whatsapp_onboarding_audit_subscription_active_read"
  ON "pg-drizzle_whatsapp_onboarding_audit_event"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
