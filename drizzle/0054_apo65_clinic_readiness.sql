CREATE TABLE "pg-drizzle_clinic_readiness" (
  "clinic_id" uuid PRIMARY KEY NOT NULL,
  "current_step" integer DEFAULT 1 NOT NULL,
  "readiness_status" text DEFAULT 'pending' NOT NULL,
  "asclepio_enabled" boolean DEFAULT false NOT NULL,
  "asclepio_enabled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "clinic_readiness_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "pg-drizzle_clinic" ("id")
    ON DELETE cascade,
  CONSTRAINT "clinic_readiness_current_step"
    CHECK ("current_step" BETWEEN 1 AND 5),
  CONSTRAINT "clinic_readiness_status"
    CHECK ("readiness_status" IN ('pending', 'ready')),
  CONSTRAINT "clinic_readiness_enabled_requires_ready"
    CHECK (NOT "asclepio_enabled" OR "readiness_status" = 'ready')
);
--> statement-breakpoint
INSERT INTO "pg-drizzle_clinic_readiness" (
  "clinic_id",
  "readiness_status",
  "asclepio_enabled",
  "asclepio_enabled_at"
)
SELECT "id", 'ready', true, now() FROM "pg-drizzle_clinic"
ON CONFLICT ("clinic_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_readiness" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_clinic_readiness" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "pg-drizzle_clinic_readiness"
  TO panacea_clinical_access;
--> statement-breakpoint
CREATE POLICY "clinic_readiness_clinic_read"
  ON "pg-drizzle_clinic_readiness"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.whatsapp_inbound', true) = 'true'
      OR current_setting('app.clinic_role', true) IN ('owner', 'doctor', 'secretary')
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
--> statement-breakpoint
CREATE POLICY "clinic_readiness_owner_insert"
  ON "pg-drizzle_clinic_readiness"
  FOR INSERT
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR current_setting('app.readiness_recalculation', true) = 'true'
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
--> statement-breakpoint
CREATE POLICY "clinic_readiness_owner_update"
  ON "pg-drizzle_clinic_readiness"
  FOR UPDATE
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR current_setting('app.readiness_recalculation', true) = 'true'
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  )
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR current_setting('app.readiness_recalculation', true) = 'true'
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
--> statement-breakpoint
CREATE POLICY "clinic_readiness_recalculation_membership_read"
  ON "pg-drizzle_clinic_user"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.readiness_recalculation', true) = 'true'
  );
--> statement-breakpoint
CREATE POLICY "clinic_readiness_recalculation_doctor_read"
  ON "pg-drizzle_doctor"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.readiness_recalculation', true) = 'true'
  );
--> statement-breakpoint
CREATE POLICY "clinic_readiness_recalculation_service_read"
  ON "pg-drizzle_service"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.readiness_recalculation', true) = 'true'
  );
--> statement-breakpoint
CREATE POLICY "clinic_readiness_recalculation_offer_read"
  ON "pg-drizzle_service_offer"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.readiness_recalculation', true) = 'true'
  );
--> statement-breakpoint
CREATE POLICY "clinic_readiness_recalculation_schedule_read"
  ON "pg-drizzle_effective_schedule"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.readiness_recalculation', true) = 'true'
  );
--> statement-breakpoint
CREATE POLICY "clinic_readiness_recalculation_period_read"
  ON "pg-drizzle_effective_schedule_period"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.readiness_recalculation', true) = 'true'
  );
--> statement-breakpoint
CREATE POLICY "clinic_readiness_recalculation_block_read"
  ON "pg-drizzle_availability_block"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.readiness_recalculation', true) = 'true'
  );
--> statement-breakpoint
CREATE POLICY "clinic_readiness_recalculation_reservation_read"
  ON "pg-drizzle_temporary_reservation"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.readiness_recalculation', true) = 'true'
  );
--> statement-breakpoint
CREATE POLICY "clinic_readiness_recalculation_invitation_read"
  ON "pg-drizzle_clinic_invitation"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.readiness_recalculation', true) = 'true'
  );
--> statement-breakpoint
GRANT UPDATE ("name") ON TABLE "pg-drizzle_clinic" TO panacea_clinical_access;
--> statement-breakpoint
CREATE POLICY "clinic_owner_updates_basic_data"
  ON "pg-drizzle_clinic"
  FOR UPDATE
  USING (
    "id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  )
  WITH CHECK (
    "id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
