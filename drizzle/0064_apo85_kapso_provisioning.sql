ALTER TABLE "pg-drizzle_whatsapp_connection"
  ADD COLUMN "business_account_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_connection_business_account_id_unique"
  ON "pg-drizzle_whatsapp_connection" USING btree ("business_account_id")
  WHERE "business_account_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_webhook_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" text NOT NULL,
  "event_name" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "lease_token" text,
  "next_attempt_at" timestamp with time zone,
  "lease_expires_at" timestamp with time zone,
  "last_error" text,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "rejected_at" timestamp with time zone,
  CONSTRAINT "whatsapp_webhook_event_status"
    CHECK ("status" IN ('pending', 'processing', 'processed', 'rejected', 'ignored')),
  CONSTRAINT "whatsapp_webhook_event_name"
    CHECK ("event_name" IN (
      'whatsapp.phone_number.created',
      'whatsapp.phone_number.deleted',
      'whatsapp.message.received',
      'whatsapp.message.sent',
      'whatsapp.message.delivered',
      'whatsapp.message.read',
      'whatsapp.message.failed',
      'whatsapp.conversation.created',
      'whatsapp.conversation.ended',
      'whatsapp.conversation.inactive'
    )),
  CONSTRAINT "whatsapp_webhook_event_idempotency_not_blank"
    CHECK (btrim("idempotency_key") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_webhook_event_idempotency_unique"
  ON "pg-drizzle_whatsapp_webhook_event" USING btree ("idempotency_key");
CREATE INDEX "whatsapp_webhook_event_status_idx"
  ON "pg-drizzle_whatsapp_webhook_event" USING btree ("status", "next_attempt_at");
CREATE INDEX "whatsapp_webhook_event_phone_idx"
  ON "pg-drizzle_whatsapp_webhook_event" USING btree ("event_name", "received_at");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_provisioning_step" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "phone_number_id" text NOT NULL,
  "step" text NOT NULL,
  "status" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "remote_id" text,
  "last_error" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "whatsapp_provisioning_step_name"
    CHECK ("step" IN ('project-webhook', 'phone-number-webhook')),
  CONSTRAINT "whatsapp_provisioning_step_status"
    CHECK ("status" IN ('succeeded', 'failed')),
  CONSTRAINT "whatsapp_provisioning_step_event_fk"
    FOREIGN KEY ("event_id")
    REFERENCES "pg-drizzle_whatsapp_webhook_event" ("id")
    ON DELETE cascade,
  CONSTRAINT "whatsapp_provisioning_step_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "pg-drizzle_clinic" ("id")
    ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_provisioning_step_event_step_unique"
  ON "pg-drizzle_whatsapp_provisioning_step" USING btree ("event_id", "step");
CREATE INDEX "whatsapp_provisioning_step_clinic_idx"
  ON "pg-drizzle_whatsapp_provisioning_step" USING btree ("clinic_id", "updated_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_webhook_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_webhook_event" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_provisioning_step" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_provisioning_step" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT INSERT ON TABLE "pg-drizzle_whatsapp_webhook_event"
  TO panacea_clinical_access;
GRANT SELECT, UPDATE ON TABLE "pg-drizzle_whatsapp_webhook_event"
  TO panacea_clinical_access;
GRANT SELECT, INSERT, UPDATE ON TABLE "pg-drizzle_whatsapp_provisioning_step"
  TO panacea_clinical_access;
GRANT SELECT, UPDATE ON TABLE "pg-drizzle_whatsapp_connection"
  TO panacea_clinical_access;
--> statement-breakpoint
CREATE POLICY "whatsapp_webhook_event_ingress_insert"
  ON "pg-drizzle_whatsapp_webhook_event"
  FOR INSERT
  WITH CHECK (
    current_setting('app.whatsapp_webhook_ingress', true) = 'true'
  );
CREATE POLICY "whatsapp_webhook_event_ingress_ack"
  ON "pg-drizzle_whatsapp_webhook_event"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_webhook_ingress', true) = 'true'
  );
CREATE POLICY "whatsapp_webhook_event_worker_manage"
  ON "pg-drizzle_whatsapp_webhook_event"
  FOR ALL
  USING (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
  )
  WITH CHECK (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
  );
CREATE POLICY "whatsapp_webhook_event_superadmin_read"
  ON "pg-drizzle_whatsapp_webhook_event"
  FOR SELECT
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
--> statement-breakpoint
CREATE POLICY "whatsapp_provisioning_step_worker_manage"
  ON "pg-drizzle_whatsapp_provisioning_step"
  FOR ALL
  USING (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
  )
  WITH CHECK (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
  );
CREATE POLICY "whatsapp_provisioning_step_clinic_owner_read"
  ON "pg-drizzle_whatsapp_provisioning_step"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
CREATE POLICY "whatsapp_provisioning_step_superadmin_read"
  ON "pg-drizzle_whatsapp_provisioning_step"
  FOR SELECT
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_connection_subscription_active_read"
  ON "pg-drizzle_whatsapp_connection";
CREATE POLICY "whatsapp_connection_subscription_active_read"
  ON "pg-drizzle_whatsapp_connection"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_inbound', true) = 'true'
    OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
CREATE POLICY "whatsapp_connection_provisioning_worker_read"
  ON "pg-drizzle_whatsapp_connection"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
  );
CREATE POLICY "whatsapp_connection_provisioning_worker_update"
  ON "pg-drizzle_whatsapp_connection"
  FOR UPDATE
  USING (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
  )
  WITH CHECK (
    current_setting('app.whatsapp_provisioning_worker', true) = 'true'
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_connection_subscription_active_update"
  ON "pg-drizzle_whatsapp_connection";
CREATE POLICY "whatsapp_connection_subscription_active_update"
  ON "pg-drizzle_whatsapp_connection"
  AS RESTRICTIVE
  FOR UPDATE
  USING (
    NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    OR current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
  )
  WITH CHECK (
    NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    OR current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
  );
