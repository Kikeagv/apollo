-- APO-94: evidencia externa del contrato de cierre, separada de los gates
-- que autorizan tráfico real.
CREATE TABLE "pg-drizzle_whatsapp_activation_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "criterion_code" text NOT NULL,
  "source" text NOT NULL,
  "evidence_reference" text,
  "pending_reason" text,
  "provisioning_event_id" uuid,
  "recorded_by_identity_id" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_activation_evidence_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "pg-drizzle_clinic" ("id")
    ON DELETE cascade,
  CONSTRAINT "whatsapp_activation_evidence_recorded_by_identity_fk"
    FOREIGN KEY ("recorded_by_identity_id")
    REFERENCES "user" ("id")
    ON DELETE restrict,
  CONSTRAINT "whatsapp_activation_evidence_provisioning_event_fk"
    FOREIGN KEY ("provisioning_event_id")
    REFERENCES "pg-drizzle_whatsapp_webhook_event" ("id")
    ON DELETE RESTRICT,
  CONSTRAINT "whatsapp_activation_evidence_criterion_code"
    CHECK ("criterion_code" IN (
      'scope-v1',
      'product-access',
      'connection-ownership',
      'technical-readiness',
      'messaging-capacity',
      'duplicate-onboarding',
      'existing-account',
      'pending-readiness',
      'stale-health',
      'retryable-operations',
      'synthetic-smoke',
      'consent-representation',
      'offboarding',
      'simulated-connection',
      'inbound-webhook',
      'transactional-outbound',
      'commercial-clinic',
      'owner-invitation',
      'admin-idempotency',
      'clinic-console',
      'template-catalog',
      'funding-health',
      'readiness-reconciliation',
      'consent-versioning',
      'welcome-return',
      'inbound-identity',
      'transactional-delivery',
      'real-e2e',
      'circuit-reactivation',
      'controlled-offboarding',
      'supervision-panel',
      'controlled-pilot'
    )),
  CONSTRAINT "whatsapp_activation_evidence_source"
    CHECK ("source" IN ('kapso', 'deployed')),
  CONSTRAINT "whatsapp_activation_evidence_reference_or_pending"
    CHECK (
      (btrim(coalesce("evidence_reference", '')) <> '' AND "pending_reason" IS NULL)
      OR
      (btrim(coalesce("pending_reason", '')) <> '' AND "evidence_reference" IS NULL)
    )
);
--> statement-breakpoint
CREATE INDEX "whatsapp_activation_evidence_clinic_criterion_source_idx"
  ON "pg-drizzle_whatsapp_activation_evidence"
  USING btree ("clinic_id", "criterion_code", "source", "updated_at");
--> statement-breakpoint
CREATE INDEX "whatsapp_activation_evidence_clinic_idx"
  ON "pg-drizzle_whatsapp_activation_evidence"
  USING btree ("clinic_id", "provisioning_event_id", "updated_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_activation_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_activation_evidence" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE "pg-drizzle_whatsapp_activation_evidence"
  TO panacea_clinical_access;
--> statement-breakpoint
CREATE POLICY "whatsapp_activation_evidence_superadmin_manage"
  ON "pg-drizzle_whatsapp_activation_evidence"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (
    NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    AND "recorded_by_identity_id" = NULLIF(current_setting('app.superadmin_id', true), '')
  );
