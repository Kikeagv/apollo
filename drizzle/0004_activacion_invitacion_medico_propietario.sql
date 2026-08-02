CREATE POLICY "clinic_invitation_activation_read"
  ON "pg-drizzle_clinic_invitation"
  FOR SELECT
  USING (
    token_hash = NULLIF(current_setting('app.invitation_token_hash', true), '')
  );
--> statement-breakpoint
CREATE POLICY "clinic_invitation_activation_consume"
  ON "pg-drizzle_clinic_invitation"
  FOR UPDATE
  USING (
    token_hash = NULLIF(current_setting('app.invitation_token_hash', true), '')
  )
  WITH CHECK (
    token_hash = NULLIF(current_setting('app.invitation_token_hash', true), '')
  );
--> statement-breakpoint
CREATE POLICY "identity_audit_unscoped_invitation_failure"
  ON "pg-drizzle_identity_audit_event"
  FOR INSERT
  WITH CHECK (
    clinic_id IS NULL
    AND action = 'identity-invitation-accepted'
  );
