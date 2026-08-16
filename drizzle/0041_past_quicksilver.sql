CREATE TABLE "pg-drizzle_apolo_audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"actor_identity_id" text NOT NULL,
	"support_session_id" uuid,
	"action" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_clinic_support_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"superadmin_identity_id" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_transfer_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"amount_usd" numeric(12, 2) NOT NULL,
	"reference" text NOT NULL,
	"recorded_by_identity_id" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic" ADD COLUMN "subscription_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "pg-drizzle_apolo_audit_event" ADD CONSTRAINT "pg-drizzle_apolo_audit_event_clinic_id_pg-drizzle_clinic_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."pg-drizzle_clinic"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_apolo_audit_event" ADD CONSTRAINT "pg-drizzle_apolo_audit_event_actor_identity_id_user_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_apolo_audit_event" ADD CONSTRAINT "pg-drizzle_apolo_audit_event_support_session_id_pg-drizzle_clinic_support_session_id_fk" FOREIGN KEY ("support_session_id") REFERENCES "public"."pg-drizzle_clinic_support_session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_support_session" ADD CONSTRAINT "pg-drizzle_clinic_support_session_clinic_id_pg-drizzle_clinic_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."pg-drizzle_clinic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_support_session" ADD CONSTRAINT "pg-drizzle_clinic_support_session_superadmin_identity_id_user_id_fk" FOREIGN KEY ("superadmin_identity_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_transfer_payment" ADD CONSTRAINT "pg-drizzle_transfer_payment_clinic_id_pg-drizzle_clinic_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."pg-drizzle_clinic"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_transfer_payment" ADD CONSTRAINT "pg-drizzle_transfer_payment_recorded_by_identity_id_user_id_fk" FOREIGN KEY ("recorded_by_identity_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apolo_audit_event_clinic_idx" ON "pg-drizzle_apolo_audit_event" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "clinic_support_session_clinic_idx" ON "pg-drizzle_clinic_support_session" USING btree ("clinic_id","expires_at");--> statement-breakpoint
CREATE INDEX "transfer_payment_clinic_idx" ON "pg-drizzle_transfer_payment" USING btree ("clinic_id");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic"
  ADD CONSTRAINT "clinic_subscription_status"
  CHECK ("subscription_status" IN ('active', 'suspended'));
--> statement-breakpoint
ALTER TABLE "pg-drizzle_transfer_payment"
  ADD CONSTRAINT "transfer_payment_positive_amount" CHECK ("amount_usd" > 0);
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_support_session"
  ADD CONSTRAINT "clinic_support_session_reason" CHECK (length(trim("reason")) > 0),
  ADD CONSTRAINT "clinic_support_session_expiry" CHECK ("expires_at" > "created_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_transfer_payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_transfer_payment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_clinic_support_session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_clinic_support_session" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_apolo_audit_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_apolo_audit_event" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "clinic_commercial_access" ON "pg-drizzle_clinic"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
--> statement-breakpoint
CREATE POLICY "transfer_payment_superadmin_access" ON "pg-drizzle_transfer_payment"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
--> statement-breakpoint
CREATE POLICY "clinic_support_session_superadmin_access" ON "pg-drizzle_clinic_support_session"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
--> statement-breakpoint
CREATE POLICY "clinic_support_session_clinic_visibility" ON "pg-drizzle_clinic_support_session"
  FOR SELECT
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "apolo_audit_superadmin_access" ON "pg-drizzle_apolo_audit_event"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
--> statement-breakpoint
CREATE POLICY "apolo_audit_clinic_visibility" ON "pg-drizzle_apolo_audit_event"
  FOR SELECT
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY "effective_schedule_configuration_write" ON "pg-drizzle_effective_schedule";
DROP POLICY "effective_schedule_period_configuration_write" ON "pg-drizzle_effective_schedule_period";
DROP POLICY "availability_block_configuration_write" ON "pg-drizzle_availability_block";
DROP POLICY "temporary_reservation_capacity_write" ON "pg-drizzle_temporary_reservation";
DROP POLICY "temporary_reservation_capacity_read" ON "pg-drizzle_temporary_reservation";
DROP POLICY "service_offer_configuration_write" ON "pg-drizzle_service_offer";
--> statement-breakpoint
CREATE POLICY "effective_schedule_configuration_write" ON "pg-drizzle_effective_schedule"
  FOR ALL USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid)
  ) WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid)
  );
--> statement-breakpoint
CREATE POLICY "effective_schedule_period_configuration_write" ON "pg-drizzle_effective_schedule_period"
  FOR ALL USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid)
  ) WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid)
  );
--> statement-breakpoint
CREATE POLICY "availability_block_configuration_write" ON "pg-drizzle_availability_block"
  FOR ALL USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid)
  ) WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid)
  );
--> statement-breakpoint
CREATE POLICY "temporary_reservation_capacity_write" ON "pg-drizzle_temporary_reservation"
  FOR ALL USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid)
  ) WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid)
  );
--> statement-breakpoint
CREATE POLICY "temporary_reservation_capacity_read" ON "pg-drizzle_temporary_reservation"
  FOR SELECT USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid
      OR current_setting('app.panacea_operation', true) = 'appointments'
    )
  );
--> statement-breakpoint
CREATE POLICY "service_offer_configuration_write" ON "pg-drizzle_service_offer"
  FOR ALL USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid)
  ) WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid)
  );
--> statement-breakpoint
DO $$
DECLARE
  target_table text;
BEGIN
  FOR target_table IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'clinic_id'
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND c.relname LIKE 'pg-drizzle_%'
      AND c.relname NOT IN (
        'pg-drizzle_transfer_payment',
        'pg-drizzle_clinic_support_session',
        'pg-drizzle_apolo_audit_event'
      )
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (current_setting(''app.subscription_status'', true) = ''active''%s)',
      'subscription_active_insert_' || substr(md5(target_table), 1, 8),
      target_table,
      CASE WHEN target_table = 'pg-drizzle_identity_audit_event' THEN ' OR clinic_id IS NULL' ELSE '' END
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE USING (current_setting(''app.subscription_status'', true) = ''active'') WITH CHECK (current_setting(''app.subscription_status'', true) = ''active'')',
      'subscription_active_update_' || substr(md5(target_table), 1, 8), target_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE USING (current_setting(''app.subscription_status'', true) = ''active'')',
      'subscription_active_delete_' || substr(md5(target_table), 1, 8), target_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (clinic_id = NULLIF(current_setting(''app.clinic_id'', true), '''')::uuid AND NULLIF(current_setting(''app.support_session_id'', true), '''') IS NOT NULL)',
      'support_read_' || substr(md5(target_table), 1, 8), target_table
    );
  END LOOP;
END $$;
--> statement-breakpoint
GRANT SELECT ON TABLE "pg-drizzle_clinic_support_session", "pg-drizzle_apolo_audit_event"
TO panacea_clinical_access;
