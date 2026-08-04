ALTER TABLE "pg-drizzle_doctor"
  ADD COLUMN "active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_doctor"
  ADD COLUMN "deactivated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_doctor"
  ADD CONSTRAINT "doctor_deactivation_consistent"
  CHECK (
    ("active" AND "deactivated_at" IS NULL)
    OR (NOT "active" AND "deactivated_at" IS NOT NULL)
  );
