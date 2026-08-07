ALTER TABLE "pg-drizzle_patient"
  ADD COLUMN "birth_date" date;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_patient"
  ADD CONSTRAINT "patient_clinic_id_unique" UNIQUE ("clinic_id", "id");
--> statement-breakpoint
CREATE INDEX "patient_clinic_idx" ON "pg-drizzle_patient" USING btree ("clinic_id");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_contact" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "name" text NOT NULL,
  "phone_e164" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contact_clinic_id_unique" UNIQUE ("clinic_id", "id"),
  CONSTRAINT "pg-drizzle_contact_clinic_id_pg-drizzle_clinic_id_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "public"."pg-drizzle_clinic"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_clinic_phone_e164_unique"
  ON "pg-drizzle_contact" USING btree ("clinic_id", "phone_e164");
--> statement-breakpoint
CREATE INDEX "contact_clinic_idx" ON "pg-drizzle_contact" USING btree ("clinic_id");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_contact_patient_link" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contact_patient_link_contact_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "contact_id")
    REFERENCES "public"."pg-drizzle_contact"("clinic_id", "id") ON DELETE cascade,
  CONSTRAINT "contact_patient_link_patient_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "patient_id")
    REFERENCES "public"."pg-drizzle_patient"("clinic_id", "id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_patient_link_unique"
  ON "pg-drizzle_contact_patient_link" USING btree ("contact_id", "patient_id");
--> statement-breakpoint
CREATE INDEX "contact_patient_link_contact_idx"
  ON "pg-drizzle_contact_patient_link" USING btree ("contact_id");
--> statement-breakpoint
CREATE INDEX "contact_patient_link_patient_idx"
  ON "pg-drizzle_contact_patient_link" USING btree ("patient_id");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_contact" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_contact_patient_link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_contact_patient_link" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "contact_clinic_isolation" ON "pg-drizzle_contact"
  FOR ALL
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "contact_patient_link_clinic_isolation"
  ON "pg-drizzle_contact_patient_link"
  FOR ALL
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE
  "pg-drizzle_contact",
  "pg-drizzle_contact_patient_link",
  "pg-drizzle_patient"
TO panacea_clinical_access;
