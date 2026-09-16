-- APO-94: conserva la modalidad elegida y ata la evidencia externa a la
-- generación de provisioning que estaba vigente cuando se registró.
ALTER TABLE "pg-drizzle_whatsapp_preflight"
  ADD COLUMN IF NOT EXISTS "onboarding_mode" text DEFAULT 'coexistence' NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'whatsapp_preflight_onboarding_mode'
  ) THEN
    ALTER TABLE "pg-drizzle_whatsapp_preflight"
      ADD CONSTRAINT "whatsapp_preflight_onboarding_mode"
      CHECK (
        "onboarding_mode" IN (
          'coexistence',
          'dedicated',
          'later',
          'not-integrated'
        )
      );
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_activation_evidence"
  ADD COLUMN IF NOT EXISTS "provisioning_event_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "pg-drizzle_whatsapp_activation_evidence"
    DROP CONSTRAINT IF EXISTS "whatsapp_activation_evidence_provisioning_event_fk";
  ALTER TABLE "pg-drizzle_whatsapp_activation_evidence"
    ADD CONSTRAINT "whatsapp_activation_evidence_provisioning_event_fk"
    FOREIGN KEY ("provisioning_event_id")
    REFERENCES "pg-drizzle_whatsapp_webhook_event" ("id")
    ON DELETE RESTRICT;
END $$;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_activation_evidence"
  DROP CONSTRAINT IF EXISTS "whatsapp_activation_evidence_criterion_code";
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_activation_evidence"
  ADD CONSTRAINT "whatsapp_activation_evidence_criterion_code"
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
  ));
--> statement-breakpoint
DROP INDEX IF EXISTS "whatsapp_activation_evidence_clinic_idx";
--> statement-breakpoint
CREATE INDEX "whatsapp_activation_evidence_clinic_idx"
  ON "pg-drizzle_whatsapp_activation_evidence"
  USING btree ("clinic_id", "provisioning_event_id", "updated_at");
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_activation_evidence_superadmin_manage"
  ON "pg-drizzle_whatsapp_activation_evidence";
--> statement-breakpoint
CREATE POLICY "whatsapp_activation_evidence_superadmin_manage"
  ON "pg-drizzle_whatsapp_activation_evidence"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (
    NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    AND "recorded_by_identity_id" = NULLIF(current_setting('app.superadmin_id', true), '')
  );
