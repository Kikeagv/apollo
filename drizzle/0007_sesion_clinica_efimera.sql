CREATE TABLE "pg-drizzle_clinic_session" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "identity_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "clinic_session_identity_idx"
  ON "pg-drizzle_clinic_session" USING btree ("identity_id");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_session" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_session" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "clinic_session_identity_isolation"
  ON "pg-drizzle_clinic_session"
  USING (identity_id = NULLIF(current_setting('app.identity_id', true), ''))
  WITH CHECK (identity_id = NULLIF(current_setting('app.identity_id', true), ''));
