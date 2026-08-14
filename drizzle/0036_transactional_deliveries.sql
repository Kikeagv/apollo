CREATE TABLE "pg-drizzle_transactional_delivery" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "appointment_id" uuid,
  "recipient_contact_id" uuid,
  "kind" text NOT NULL CHECK ("kind" IN ('appointment-reminder', 'daily-agenda-pdf')),
  "idempotency_key" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending', 'processing', 'sent', 'failed', 'suppressed')),
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "lease_expires_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "last_error" text,
  "retain_until" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "transactional_delivery_clinic_id_unique" UNIQUE ("clinic_id", "id"),
  CONSTRAINT "transactional_delivery_appointment_same_clinic_fk" FOREIGN KEY ("clinic_id", "appointment_id") REFERENCES "pg-drizzle_appointment"("clinic_id", "id") ON DELETE CASCADE,
  CONSTRAINT "transactional_delivery_recipient_same_clinic_fk" FOREIGN KEY ("clinic_id", "recipient_contact_id") REFERENCES "pg-drizzle_contact"("clinic_id", "id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transactional_delivery_clinic_key_unique" ON "pg-drizzle_transactional_delivery" USING btree ("clinic_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "transactional_delivery_ready_idx" ON "pg-drizzle_transactional_delivery" USING btree ("status", "next_attempt_at");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_transactional_delivery_attempt" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "delivery_id" uuid NOT NULL,
  "attempt" integer NOT NULL,
  "outcome" text NOT NULL CHECK ("outcome" IN ('delivered', 'failed', 'callback')),
  "provider_status" text,
  "error" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retain_until" timestamp with time zone NOT NULL,
  CONSTRAINT "transactional_delivery_attempt_delivery_same_clinic_fk" FOREIGN KEY ("clinic_id", "delivery_id") REFERENCES "pg-drizzle_transactional_delivery"("clinic_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transactional_delivery_callback_unique" ON "pg-drizzle_transactional_delivery_attempt" USING btree ("delivery_id") WHERE "outcome" = 'callback';
--> statement-breakpoint
CREATE TABLE "pg-drizzle_transactional_delivery_alert" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "delivery_id" uuid NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by_clinic_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retain_until" timestamp with time zone NOT NULL,
  CONSTRAINT "transactional_delivery_alert_delivery_same_clinic_fk" FOREIGN KEY ("clinic_id", "delivery_id") REFERENCES "pg-drizzle_transactional_delivery"("clinic_id", "id") ON DELETE CASCADE,
  CONSTRAINT "transactional_delivery_alert_resolver_same_clinic_fk" FOREIGN KEY ("clinic_id", "resolved_by_clinic_user_id") REFERENCES "pg-drizzle_clinic_user"("clinic_id", "id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transactional_delivery_alert_delivery_unique" ON "pg-drizzle_transactional_delivery_alert" USING btree ("delivery_id");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_transactional_delivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_transactional_delivery" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_transactional_delivery_attempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_transactional_delivery_attempt" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_transactional_delivery_alert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_transactional_delivery_alert" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "transactional_delivery_scheduler_access" ON "pg-drizzle_transactional_delivery" FOR ALL USING (current_setting('app.appointment_scheduler', true) = 'true') WITH CHECK (current_setting('app.appointment_scheduler', true) = 'true');
CREATE POLICY "transactional_delivery_clinic_read" ON "pg-drizzle_transactional_delivery" FOR SELECT USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
CREATE POLICY "transactional_delivery_attempt_scheduler_access" ON "pg-drizzle_transactional_delivery_attempt" FOR ALL USING (current_setting('app.appointment_scheduler', true) = 'true') WITH CHECK (current_setting('app.appointment_scheduler', true) = 'true');
CREATE POLICY "transactional_delivery_attempt_clinic_read" ON "pg-drizzle_transactional_delivery_attempt" FOR SELECT USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
CREATE POLICY "transactional_delivery_alert_scheduler_access" ON "pg-drizzle_transactional_delivery_alert" FOR ALL USING (current_setting('app.appointment_scheduler', true) = 'true') WITH CHECK (current_setting('app.appointment_scheduler', true) = 'true');
CREATE POLICY "transactional_delivery_alert_clinic_read" ON "pg-drizzle_transactional_delivery_alert" FOR SELECT USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
CREATE POLICY "transactional_delivery_alert_clinic_resolve" ON "pg-drizzle_transactional_delivery_alert" FOR UPDATE USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid) WITH CHECK ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, UPDATE ON "pg-drizzle_transactional_delivery_alert" TO panacea_clinical_access;
GRANT SELECT ON "pg-drizzle_transactional_delivery", "pg-drizzle_transactional_delivery_attempt" TO panacea_clinical_access;
