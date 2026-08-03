CREATE TABLE "pg-drizzle_trusted_clinic_device" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "identity_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trusted_clinic_device_identity_idx"
  ON "pg-drizzle_trusted_clinic_device" USING btree ("identity_id");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_trusted_clinic_device" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_trusted_clinic_device" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "trusted_clinic_device_identity_isolation"
  ON "pg-drizzle_trusted_clinic_device"
  USING (identity_id = NULLIF(current_setting('app.identity_id', true), ''))
  WITH CHECK (identity_id = NULLIF(current_setting('app.identity_id', true), ''));
--> statement-breakpoint
CREATE POLICY "identity_audit_unscoped_login_failure"
  ON "pg-drizzle_identity_audit_event"
  FOR INSERT
  WITH CHECK (
    clinic_id IS NULL
    AND action = 'identity-login-failed'
  );
