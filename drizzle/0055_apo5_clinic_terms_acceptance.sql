ALTER TABLE "pg-drizzle_clinic_readiness"
  ADD COLUMN "terms_accepted_at" timestamp with time zone,
  ADD COLUMN "terms_accepted_by_identity_id" text,
  ADD COLUMN "terms_accepted_version" text;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_readiness"
  ADD CONSTRAINT "clinic_readiness_terms_accepted_by_identity_fk"
  FOREIGN KEY ("terms_accepted_by_identity_id")
  REFERENCES "user" ("id")
  ON DELETE set null;
