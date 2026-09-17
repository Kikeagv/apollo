ALTER TABLE "pg-drizzle_clinic_invitation"
  ADD COLUMN IF NOT EXISTS "accepted_identity_id" text;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_invitation"
  ADD COLUMN IF NOT EXISTS "accepted_identity_created" boolean;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_invitation"
  ADD COLUMN IF NOT EXISTS "delivery_attempt_id" uuid;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_invitation"
  ADD COLUMN IF NOT EXISTS "delivery_lease_expires_at" timestamptz;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'clinic_invitation_accepted_identity_fk'
  ) THEN
    ALTER TABLE "pg-drizzle_clinic_invitation"
      ADD CONSTRAINT "clinic_invitation_accepted_identity_fk"
      FOREIGN KEY ("accepted_identity_id")
      REFERENCES "public"."user"("id")
      ON DELETE SET NULL;
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_user_clinic_identity_unique"
  ON "pg-drizzle_clinic_user" USING btree ("clinic_id", "identity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_user_owner_unique"
  ON "pg-drizzle_clinic_user" USING btree ("clinic_id")
  WHERE "role" = 'owner';
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "user", "account"
  TO panacea_clinical_access;
--> statement-breakpoint
GRANT INSERT ON TABLE "pg-drizzle_clinic_user"
  TO panacea_clinical_access;
