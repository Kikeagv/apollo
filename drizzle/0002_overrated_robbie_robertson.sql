ALTER TABLE "pg-drizzle_clinic_invitation"
  ADD COLUMN "owner_name" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_invitation"
  ALTER COLUMN "owner_name" DROP DEFAULT;
