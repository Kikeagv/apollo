CREATE TABLE "pg-drizzle_appointment_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_clinic_user_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment" ADD COLUMN "patient_id" uuid;--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment" ADD COLUMN "service_offer_id" uuid;--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment" ADD COLUMN "actor_clinic_user_id" uuid;--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment" ADD COLUMN "price_usd" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment" ADD COLUMN "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment" ADD COLUMN "buffer_minutes" integer;--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment" ADD COLUMN "occupied_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment" ADD CONSTRAINT "appointment_clinic_id_unique" UNIQUE("clinic_id","id");--> statement-breakpoint
ALTER TABLE "pg-drizzle_service_offer" ADD CONSTRAINT "service_offer_clinic_id_unique" UNIQUE("clinic_id","id");--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment_event" ADD CONSTRAINT "appointment_event_appointment_same_clinic_fk" FOREIGN KEY ("clinic_id","appointment_id") REFERENCES "public"."pg-drizzle_appointment"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment_event" ADD CONSTRAINT "appointment_event_actor_same_clinic_fk" FOREIGN KEY ("clinic_id","actor_clinic_user_id") REFERENCES "public"."pg-drizzle_clinic_user"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_event_appointment_idx" ON "pg-drizzle_appointment_event" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "appointment_event_clinic_idx" ON "pg-drizzle_appointment_event" USING btree ("clinic_id");--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment" ADD CONSTRAINT "appointment_patient_same_clinic_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."pg-drizzle_patient"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment" ADD CONSTRAINT "appointment_service_offer_same_clinic_fk" FOREIGN KEY ("clinic_id","service_offer_id") REFERENCES "public"."pg-drizzle_service_offer"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment" ADD CONSTRAINT "appointment_actor_same_clinic_fk" FOREIGN KEY ("clinic_id","actor_clinic_user_id") REFERENCES "public"."pg-drizzle_clinic_user"("clinic_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment_event" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY "appointment_capacity_access" ON "pg-drizzle_appointment";
--> statement-breakpoint
CREATE POLICY "appointment_operating_access" ON "pg-drizzle_appointment"
  FOR ALL
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "appointment_event_operating_read" ON "pg-drizzle_appointment_event"
  FOR SELECT
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "appointment_event_append" ON "pg-drizzle_appointment_event"
  FOR INSERT
  WITH CHECK ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY "temporary_reservation_capacity_access" ON "pg-drizzle_temporary_reservation";
--> statement-breakpoint
CREATE POLICY "temporary_reservation_operating_read" ON "pg-drizzle_temporary_reservation"
  FOR SELECT
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "temporary_reservation_capacity_write" ON "pg-drizzle_temporary_reservation"
  FOR ALL
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
--> statement-breakpoint
DROP POLICY "effective_schedule_configuration_access" ON "pg-drizzle_effective_schedule";
--> statement-breakpoint
CREATE POLICY "effective_schedule_operating_read" ON "pg-drizzle_effective_schedule"
  FOR SELECT
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "effective_schedule_configuration_write" ON "pg-drizzle_effective_schedule"
  FOR ALL
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  )
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
--> statement-breakpoint
DROP POLICY "effective_schedule_period_configuration_access" ON "pg-drizzle_effective_schedule_period";
--> statement-breakpoint
CREATE POLICY "effective_schedule_period_operating_read" ON "pg-drizzle_effective_schedule_period"
  FOR SELECT
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "effective_schedule_period_configuration_write" ON "pg-drizzle_effective_schedule_period"
  FOR ALL
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  )
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
--> statement-breakpoint
DROP POLICY "availability_block_configuration_access" ON "pg-drizzle_availability_block";
--> statement-breakpoint
CREATE POLICY "availability_block_operating_read" ON "pg-drizzle_availability_block"
  FOR SELECT
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "availability_block_configuration_write" ON "pg-drizzle_availability_block"
  FOR ALL
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  )
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
--> statement-breakpoint
DROP POLICY "service_catalog_read" ON "pg-drizzle_service";
--> statement-breakpoint
CREATE POLICY "service_operating_read" ON "pg-drizzle_service"
  FOR SELECT
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY "service_offer_configuration_access" ON "pg-drizzle_service_offer";
--> statement-breakpoint
CREATE POLICY "service_offer_operating_read" ON "pg-drizzle_service_offer"
  FOR SELECT
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "service_offer_configuration_write" ON "pg-drizzle_service_offer"
  FOR ALL
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  )
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR "doctor_id" = NULLIF(current_setting('app.doctor_id', true), '')::uuid
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "pg-drizzle_appointment_event"
TO panacea_clinical_access;
