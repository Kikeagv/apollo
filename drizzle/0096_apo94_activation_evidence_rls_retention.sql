-- APO-94: la evidencia es historial append-only y conserva la referencia de
-- generación aunque se depuren los payloads de la cola de webhooks.
ALTER TABLE "pg-drizzle_whatsapp_activation_evidence"
  DROP CONSTRAINT IF EXISTS "whatsapp_activation_evidence_provisioning_event_fk";
--> statement-breakpoint
REVOKE UPDATE, DELETE
  ON TABLE "pg-drizzle_whatsapp_activation_evidence"
  FROM panacea_clinical_access;
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_activation_evidence_superadmin_manage"
  ON "pg-drizzle_whatsapp_activation_evidence";
--> statement-breakpoint
CREATE POLICY "whatsapp_activation_evidence_superadmin_read"
  ON "pg-drizzle_whatsapp_activation_evidence"
  FOR SELECT
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
--> statement-breakpoint
CREATE POLICY "whatsapp_activation_evidence_superadmin_insert"
  ON "pg-drizzle_whatsapp_activation_evidence"
  FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    AND "recorded_by_identity_id" = NULLIF(current_setting('app.superadmin_id', true), '')
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "clinic_invitation_apolo_superadmin_read"
  ON "pg-drizzle_clinic_invitation";
--> statement-breakpoint
CREATE POLICY "clinic_invitation_apolo_superadmin_read"
  ON "pg-drizzle_clinic_invitation"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "clinic_membership_apolo_superadmin_read"
  ON "pg-drizzle_clinic_user";
--> statement-breakpoint
CREATE POLICY "clinic_membership_apolo_superadmin_read"
  ON "pg-drizzle_clinic_user"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
