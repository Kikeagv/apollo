CREATE TABLE "pg-drizzle_doctor" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "clinic_user_id" uuid NOT NULL,
  "public_name" text,
  "primary_specialty" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg-drizzle_doctor_clinic_id_pg-drizzle_clinic_id_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "public"."pg-drizzle_clinic"("id") ON DELETE cascade,
  CONSTRAINT "pg-drizzle_doctor_clinic_user_id_pg-drizzle_clinic_user_id_fk"
    FOREIGN KEY ("clinic_user_id") REFERENCES "public"."pg-drizzle_clinic_user"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_configuration_audit_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "actor_identity_id" text,
  "entity" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "action" text NOT NULL,
  "before_values" jsonb,
  "after_values" jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg-drizzle_configuration_audit_event_clinic_id_pg-drizzle_clinic_id_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "public"."pg-drizzle_clinic"("id") ON DELETE cascade,
  CONSTRAINT "pg-drizzle_configuration_audit_event_actor_identity_id_user_id_fk"
    FOREIGN KEY ("actor_identity_id") REFERENCES "public"."user"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_clinic_user_idx"
  ON "pg-drizzle_doctor" USING btree ("clinic_user_id");
--> statement-breakpoint
CREATE INDEX "doctor_clinic_idx"
  ON "pg-drizzle_doctor" USING btree ("clinic_id");
--> statement-breakpoint
CREATE INDEX "configuration_audit_clinic_idx"
  ON "pg-drizzle_configuration_audit_event" USING btree ("clinic_id");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_doctor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_doctor" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_configuration_audit_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_configuration_audit_event" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "doctor_clinic_isolation" ON "pg-drizzle_doctor"
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "configuration_audit_clinic_isolation"
  ON "pg-drizzle_configuration_audit_event"
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "pg-drizzle_doctor"
  TO panacea_clinical_access;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "pg-drizzle_configuration_audit_event"
  TO panacea_clinical_access;
