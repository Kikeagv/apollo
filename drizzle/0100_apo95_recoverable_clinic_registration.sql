-- APO-95: el alta comercial/sintética es idempotente y la entrega de la
-- invitación queda separada del resultado de crear la Clínica.
ALTER TABLE "pg-drizzle_clinic"
  ADD COLUMN IF NOT EXISTS "registration_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_registration_key_unique"
  ON "pg-drizzle_clinic" USING btree ("registration_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_invitation_owner_unique"
  ON "pg-drizzle_clinic_invitation" USING btree ("clinic_id")
  WHERE "role" = 'owner';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pg-drizzle_clinic_invitation_delivery" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "invitation_id" uuid NOT NULL,
  "actor_identity_id" text,
  "result" text NOT NULL,
  "failure_reason" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "clinic_invitation_delivery_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "public"."pg-drizzle_clinic"("id")
    ON DELETE cascade,
  CONSTRAINT "clinic_invitation_delivery_invitation_fk"
    FOREIGN KEY ("invitation_id")
    REFERENCES "public"."pg-drizzle_clinic_invitation"("id")
    ON DELETE cascade,
  CONSTRAINT "clinic_invitation_delivery_actor_fk"
    FOREIGN KEY ("actor_identity_id")
    REFERENCES "public"."user"("id")
    ON DELETE set null,
  CONSTRAINT "clinic_invitation_delivery_result"
    CHECK ("result" IN ('failed', 'succeeded')),
  CONSTRAINT "clinic_invitation_delivery_failure_reason"
    CHECK (
      "result" = 'succeeded'
      OR NULLIF(btrim("failure_reason"), '') IS NOT NULL
    )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clinic_invitation_delivery_clinic_idx"
  ON "pg-drizzle_clinic_invitation_delivery" USING btree
  ("clinic_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clinic_invitation_delivery_invitation_idx"
  ON "pg-drizzle_clinic_invitation_delivery" USING btree
  ("invitation_id", "occurred_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_invitation_delivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_clinic_invitation_delivery" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON TABLE "pg-drizzle_clinic_invitation_delivery"
  TO panacea_clinical_access;
--> statement-breakpoint
DROP POLICY IF EXISTS "clinic_invitation_delivery_superadmin_access"
  ON "pg-drizzle_clinic_invitation_delivery";
CREATE POLICY "clinic_invitation_delivery_superadmin_access"
  ON "pg-drizzle_clinic_invitation_delivery"
  FOR ALL
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  )
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "clinic_invitation_delivery_owner_read"
  ON "pg-drizzle_clinic_invitation_delivery";
CREATE POLICY "clinic_invitation_delivery_owner_read"
  ON "pg-drizzle_clinic_invitation_delivery"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
