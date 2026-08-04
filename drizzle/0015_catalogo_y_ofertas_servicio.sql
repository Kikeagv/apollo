ALTER TABLE "pg-drizzle_doctor"
  ADD CONSTRAINT "doctor_clinic_id_unique" UNIQUE ("clinic_id", "id");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_service" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "description" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "service_clinic_id_unique" UNIQUE ("clinic_id", "id"),
  CONSTRAINT "pg-drizzle_service_clinic_id_pg-drizzle_clinic_id_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "public"."pg-drizzle_clinic"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "service_clinic_normalized_name_unique"
  ON "pg-drizzle_service" USING btree ("clinic_id", "normalized_name");
--> statement-breakpoint
CREATE INDEX "service_clinic_idx" ON "pg-drizzle_service" USING btree ("clinic_id");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_service_offer" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "service_id" uuid NOT NULL,
  "doctor_id" uuid NOT NULL,
  "price_usd" numeric(12, 2) NOT NULL,
  "duration_minutes" integer NOT NULL,
  "buffer_minutes" integer NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "deactivated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "service_offer_service_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "service_id")
    REFERENCES "public"."pg-drizzle_service"("clinic_id", "id") ON DELETE cascade,
  CONSTRAINT "service_offer_doctor_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "doctor_id")
    REFERENCES "public"."pg-drizzle_doctor"("clinic_id", "id") ON DELETE restrict,
  CONSTRAINT "service_offer_price_non_negative" CHECK ("price_usd" >= 0),
  CONSTRAINT "service_offer_duration_five_minutes"
    CHECK ("duration_minutes" > 0 AND "duration_minutes" % 5 = 0),
  CONSTRAINT "service_offer_buffer_five_minutes"
    CHECK ("buffer_minutes" >= 0 AND "buffer_minutes" % 5 = 0),
  CONSTRAINT "service_offer_deactivation_consistent"
    CHECK (("active" AND "deactivated_at" IS NULL) OR (NOT "active" AND "deactivated_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "service_offer_clinic_idx" ON "pg-drizzle_service_offer" USING btree ("clinic_id");
--> statement-breakpoint
CREATE INDEX "service_offer_service_idx" ON "pg-drizzle_service_offer" USING btree ("service_id");
--> statement-breakpoint
CREATE INDEX "service_offer_doctor_idx" ON "pg-drizzle_service_offer" USING btree ("doctor_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "service_offer_one_active_doctor_service"
  ON "pg-drizzle_service_offer" USING btree ("doctor_id", "service_id")
  WHERE "active";
--> statement-breakpoint
ALTER TABLE "pg-drizzle_service" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_service" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_service_offer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_service_offer" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "service_catalog_read" ON "pg-drizzle_service"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) IN ('owner', 'doctor')
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
--> statement-breakpoint
CREATE POLICY "service_catalog_owner_write" ON "pg-drizzle_service"
  FOR INSERT
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
--> statement-breakpoint
CREATE POLICY "service_offer_configuration_access" ON "pg-drizzle_service_offer"
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
GRANT SELECT, INSERT, UPDATE ON TABLE "pg-drizzle_service", "pg-drizzle_service_offer"
  TO panacea_clinical_access;
