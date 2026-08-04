CREATE TABLE "pg-drizzle_effective_schedule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "doctor_id" uuid NOT NULL,
  "effective_from" date NOT NULL,
  "effective_until" date,
  "timezone" text DEFAULT 'America/El_Salvador' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "effective_schedule_clinic_id_unique" UNIQUE ("clinic_id", "id"),
  CONSTRAINT "effective_schedule_clinic_doctor_id_unique" UNIQUE ("clinic_id", "doctor_id", "id"),
  CONSTRAINT "effective_schedule_validity_order" CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from"),
  CONSTRAINT "effective_schedule_timezone" CHECK ("timezone" = 'America/El_Salvador'),
  CONSTRAINT "effective_schedule_doctor_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "doctor_id")
    REFERENCES "public"."pg-drizzle_doctor"("clinic_id", "id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "effective_schedule_doctor_idx"
  ON "pg-drizzle_effective_schedule" USING btree ("clinic_id", "doctor_id", "effective_from");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_effective_schedule_period" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "doctor_id" uuid NOT NULL,
  "schedule_id" uuid NOT NULL,
  "day_of_week" integer NOT NULL,
  "start_time" time NOT NULL,
  "end_time" time NOT NULL,
  CONSTRAINT "effective_schedule_period_day_of_week" CHECK ("day_of_week" BETWEEN 0 AND 6),
  CONSTRAINT "effective_schedule_period_no_midnight_crossing" CHECK ("start_time" < "end_time"),
  CONSTRAINT "effective_schedule_period_doctor_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "doctor_id")
    REFERENCES "public"."pg-drizzle_doctor"("clinic_id", "id") ON DELETE cascade,
  CONSTRAINT "effective_schedule_period_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "schedule_id")
    REFERENCES "public"."pg-drizzle_effective_schedule"("clinic_id", "id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "effective_schedule_period_schedule_idx"
  ON "pg-drizzle_effective_schedule_period" USING btree ("schedule_id");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_availability_block" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "doctor_id" uuid NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "private_label" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "availability_block_interval_order" CHECK ("starts_at" < "ends_at"),
  CONSTRAINT "availability_block_one_local_day" CHECK (
    ("starts_at" AT TIME ZONE 'America/El_Salvador')::date =
    ("ends_at" AT TIME ZONE 'America/El_Salvador')::date
  ),
  CONSTRAINT "availability_block_doctor_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "doctor_id")
    REFERENCES "public"."pg-drizzle_doctor"("clinic_id", "id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "availability_block_doctor_starts_at_idx"
  ON "pg-drizzle_availability_block" USING btree ("clinic_id", "doctor_id", "starts_at");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_appointment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "doctor_id" uuid NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'confirmed' NOT NULL,
  CONSTRAINT "appointment_interval_order" CHECK ("starts_at" < "ends_at"),
  CONSTRAINT "appointment_confirmed_status" CHECK ("status" = 'confirmed'),
  CONSTRAINT "appointment_doctor_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "doctor_id")
    REFERENCES "public"."pg-drizzle_doctor"("clinic_id", "id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "appointment_doctor_starts_at_idx"
  ON "pg-drizzle_appointment" USING btree ("clinic_id", "doctor_id", "starts_at");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_temporary_reservation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "doctor_id" uuid NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "temporary_reservation_interval_order" CHECK ("starts_at" < "ends_at"),
  CONSTRAINT "temporary_reservation_doctor_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "doctor_id")
    REFERENCES "public"."pg-drizzle_doctor"("clinic_id", "id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "temporary_reservation_doctor_starts_at_idx"
  ON "pg-drizzle_temporary_reservation" USING btree ("clinic_id", "doctor_id", "starts_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_effective_schedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_effective_schedule" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_effective_schedule_period" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_effective_schedule_period" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_availability_block" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_availability_block" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_appointment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_temporary_reservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_temporary_reservation" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "effective_schedule_configuration_access" ON "pg-drizzle_effective_schedule"
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
CREATE POLICY "effective_schedule_period_configuration_access" ON "pg-drizzle_effective_schedule_period"
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
CREATE POLICY "availability_block_configuration_access" ON "pg-drizzle_availability_block"
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
CREATE POLICY "appointment_capacity_access" ON "pg-drizzle_appointment"
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
CREATE POLICY "temporary_reservation_capacity_access" ON "pg-drizzle_temporary_reservation"
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
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "pg-drizzle_effective_schedule",
  "pg-drizzle_effective_schedule_period",
  "pg-drizzle_availability_block",
  "pg-drizzle_appointment",
  "pg-drizzle_temporary_reservation"
TO panacea_clinical_access;
