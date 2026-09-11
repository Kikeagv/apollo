-- APO-77: let the provisioning worker persist readiness and operational
-- alerts without widening clinic-user permissions.
CREATE TABLE "pg-drizzle_whatsapp_connection_alert" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "provisioning_event_id" uuid NOT NULL,
  "gate_code" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "reason" text NOT NULL,
  "next_action" text NOT NULL,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_connection_alert_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "pg-drizzle_clinic" ("id")
    ON DELETE cascade,
  CONSTRAINT "whatsapp_connection_alert_event_fk"
    FOREIGN KEY ("provisioning_event_id")
    REFERENCES "pg-drizzle_whatsapp_webhook_event" ("id")
    ON DELETE cascade,
  CONSTRAINT "whatsapp_connection_alert_gate_code"
    CHECK ("gate_code" IN ('number', 'webhooks', 'templates', 'billing', 'e2e')),
  CONSTRAINT "whatsapp_connection_alert_status"
    CHECK ("status" IN ('open', 'resolved')),
  CONSTRAINT "whatsapp_connection_alert_reason_not_blank"
    CHECK (btrim("reason") <> ''),
  CONSTRAINT "whatsapp_connection_alert_next_action_not_blank"
    CHECK (btrim("next_action") <> ''),
  CONSTRAINT "whatsapp_connection_alert_resolution"
    CHECK ("status" = 'open' OR "resolved_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_connection_alert_generation_gate_unique"
  ON "pg-drizzle_whatsapp_connection_alert"
  USING btree ("clinic_id", "provisioning_event_id", "gate_code");
CREATE INDEX "whatsapp_connection_alert_clinic_status_idx"
  ON "pg-drizzle_whatsapp_connection_alert"
  USING btree ("clinic_id", "status", "updated_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_readiness" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_readiness" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_critical_template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_critical_template" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_billing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_billing" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_connection_alert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_connection_alert" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE "pg-drizzle_whatsapp_connection_alert"
  TO panacea_clinical_access;
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_readiness_subscription_active_read"
  ON "pg-drizzle_whatsapp_readiness";
CREATE POLICY "whatsapp_readiness_subscription_active_read"
  ON "pg-drizzle_whatsapp_readiness"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
DROP POLICY IF EXISTS "whatsapp_critical_template_subscription_active_read"
  ON "pg-drizzle_whatsapp_critical_template";
CREATE POLICY "whatsapp_critical_template_subscription_active_read"
  ON "pg-drizzle_whatsapp_critical_template"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
DROP POLICY IF EXISTS "whatsapp_billing_subscription_active_read"
  ON "pg-drizzle_whatsapp_billing";
CREATE POLICY "whatsapp_billing_subscription_active_read"
  ON "pg-drizzle_whatsapp_billing"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_readiness_provisioning_worker_manage"
  ON "pg-drizzle_whatsapp_readiness"
  FOR ALL
  USING (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
CREATE POLICY "whatsapp_critical_template_provisioning_worker_manage"
  ON "pg-drizzle_whatsapp_critical_template"
  FOR ALL
  USING (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
CREATE POLICY "whatsapp_billing_provisioning_worker_manage"
  ON "pg-drizzle_whatsapp_billing"
  FOR ALL
  USING (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
CREATE POLICY "whatsapp_connection_alert_superadmin_manage"
  ON "pg-drizzle_whatsapp_connection_alert"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_connection_alert_provisioning_worker_manage"
  ON "pg-drizzle_whatsapp_connection_alert"
  FOR ALL
  USING (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_webhook_event_superadmin_retry"
  ON "pg-drizzle_whatsapp_webhook_event"
  FOR UPDATE
  USING (
    NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    AND "event_name" = 'whatsapp.phone_number.created'
  )
  WITH CHECK (
    NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    AND "event_name" = 'whatsapp.phone_number.created'
  );
