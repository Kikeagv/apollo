-- APO-92: close the synthetic WhatsApp smoke, real-traffic gate and offboarding slice.
ALTER TABLE "pg-drizzle_whatsapp_connection"
  ADD COLUMN "real_traffic_status" text DEFAULT 'blocked' NOT NULL,
  ADD COLUMN "real_traffic_enabled_at" timestamp with time zone,
  ADD COLUMN "real_traffic_enabled_by_identity_id" text;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_connection"
  ADD CONSTRAINT "whatsapp_connection_real_traffic_status"
    CHECK ("real_traffic_status" IN ('blocked', 'enabled', 'offboarded'));
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_connection"
  ADD CONSTRAINT "whatsapp_connection_real_traffic_enabled_by_identity_id_user_id_fk"
    FOREIGN KEY ("real_traffic_enabled_by_identity_id") REFERENCES "user" ("id")
    ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_traffic_gate_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "code" text NOT NULL,
  "ready" boolean DEFAULT false NOT NULL,
  "evidence_reference" text,
  "recorded_by_identity_id" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_traffic_gate_evidence_clinic_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "pg-drizzle_clinic" ("id") ON DELETE CASCADE,
  CONSTRAINT "whatsapp_traffic_gate_evidence_identity_fk"
    FOREIGN KEY ("recorded_by_identity_id") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "whatsapp_traffic_gate_evidence_code"
    CHECK ("code" IN ('consent', 'contract', 'privacy', 'retention', 'dpa', 'transfers', 'billing', 'product-approval')),
  CONSTRAINT "whatsapp_traffic_gate_evidence_reference"
    CHECK ("ready" = false OR btrim(coalesce("evidence_reference", '')) <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_traffic_gate_evidence_clinic_code_unique"
  ON "pg-drizzle_whatsapp_traffic_gate_evidence" USING btree ("clinic_id", "code");
CREATE INDEX "whatsapp_traffic_gate_evidence_clinic_idx"
  ON "pg-drizzle_whatsapp_traffic_gate_evidence" USING btree ("clinic_id", "updated_at");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_smoke_run" (
  "id" uuid PRIMARY KEY NOT NULL,
  "clinic_id" uuid NOT NULL,
  "actor_identity_id" text NOT NULL,
  "status" text NOT NULL,
  "synthetic_contact" boolean NOT NULL,
  "real_patients_enabled" boolean NOT NULL,
  "steps" jsonb NOT NULL,
  "blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "evidence" text,
  "started_at" timestamp with time zone NOT NULL,
  "finished_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_smoke_run_clinic_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "pg-drizzle_clinic" ("id") ON DELETE CASCADE,
  CONSTRAINT "whatsapp_smoke_run_identity_fk"
    FOREIGN KEY ("actor_identity_id") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "whatsapp_smoke_run_result_safety"
    CHECK ("status" = 'failed' OR ("synthetic_contact" = true AND "real_patients_enabled" = false)),
  CONSTRAINT "whatsapp_smoke_run_status"
    CHECK ("status" IN ('failed', 'passed'))
);
--> statement-breakpoint
CREATE INDEX "whatsapp_smoke_run_clinic_finished_idx"
  ON "pg-drizzle_whatsapp_smoke_run" USING btree ("clinic_id", "finished_at");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_offboarding_run" (
  "id" uuid PRIMARY KEY NOT NULL,
  "clinic_id" uuid NOT NULL,
  "actor_identity_id" text NOT NULL,
  "status" text NOT NULL,
  "configuration_export" jsonb NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_offboarding_run_clinic_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "pg-drizzle_clinic" ("id") ON DELETE CASCADE,
  CONSTRAINT "whatsapp_offboarding_run_identity_fk"
    FOREIGN KEY ("actor_identity_id") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "whatsapp_offboarding_run_status"
    CHECK ("status" IN ('running', 'completed', 'failed')),
  CONSTRAINT "whatsapp_offboarding_run_completion"
    CHECK ("status" = 'running' OR "completed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "whatsapp_offboarding_run_clinic_started_idx"
  ON "pg-drizzle_whatsapp_offboarding_run" USING btree ("clinic_id", "started_at");
ALTER TABLE "pg-drizzle_whatsapp_offboarding_run"
  ADD CONSTRAINT "whatsapp_offboarding_run_clinic_id_unique"
  UNIQUE ("clinic_id", "id");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_offboarding_step_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "step" text NOT NULL,
  "status" text NOT NULL,
  "effect" text NOT NULL,
  "message" text NOT NULL,
  "evidence" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_offboarding_step_audit_clinic_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "pg-drizzle_clinic" ("id") ON DELETE CASCADE,
  CONSTRAINT "whatsapp_offboarding_step_audit_run_fk"
    FOREIGN KEY ("run_id") REFERENCES "pg-drizzle_whatsapp_offboarding_run" ("id") ON DELETE CASCADE,
  CONSTRAINT "whatsapp_offboarding_step_audit_run_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "run_id") REFERENCES "pg-drizzle_whatsapp_offboarding_run" ("clinic_id", "id") ON DELETE CASCADE,
  CONSTRAINT "whatsapp_offboarding_step_audit_step"
    CHECK ("step" IN ('stop-sends', 'disconnect-connection', 'disable-project-webhook', 'disable-phone-webhook', 'revoke-setup-links', 'export-configuration')),
  CONSTRAINT "whatsapp_offboarding_step_audit_status"
    CHECK ("status" IN ('succeeded', 'failed')),
  CONSTRAINT "whatsapp_offboarding_step_audit_effect"
    CHECK ("effect" IN ('changed', 'already-complete'))
);
--> statement-breakpoint
CREATE INDEX "whatsapp_offboarding_step_audit_run_idx"
  ON "pg-drizzle_whatsapp_offboarding_step_audit" USING btree ("run_id", "occurred_at");
CREATE INDEX "whatsapp_offboarding_step_audit_clinic_idx"
  ON "pg-drizzle_whatsapp_offboarding_step_audit" USING btree ("clinic_id", "occurred_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_traffic_gate_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_traffic_gate_evidence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_smoke_run" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_smoke_run" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_offboarding_run" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_offboarding_run" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_offboarding_step_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_offboarding_step_audit" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE
  "pg-drizzle_whatsapp_traffic_gate_evidence",
  "pg-drizzle_whatsapp_smoke_run",
  "pg-drizzle_whatsapp_offboarding_run",
  "pg-drizzle_whatsapp_offboarding_step_audit"
  TO panacea_clinical_access;
--> statement-breakpoint
CREATE POLICY "whatsapp_traffic_gate_evidence_superadmin_manage"
  ON "pg-drizzle_whatsapp_traffic_gate_evidence"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_smoke_run_superadmin_manage"
  ON "pg-drizzle_whatsapp_smoke_run"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_offboarding_run_superadmin_manage"
  ON "pg-drizzle_whatsapp_offboarding_run"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_offboarding_step_audit_superadmin_read"
  ON "pg-drizzle_whatsapp_offboarding_step_audit"
  FOR SELECT
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_offboarding_step_audit_superadmin_append"
  ON "pg-drizzle_whatsapp_offboarding_step_audit"
  FOR INSERT
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
