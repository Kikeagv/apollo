ALTER TABLE "pg-drizzle_contact_patient_link"
  ADD COLUMN "relationship" text DEFAULT 'contact' NOT NULL,
  ADD COLUMN "guardian_dui" text,
  ADD COLUMN "guardianship_verification_status" text;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_contact_patient_link"
  ADD CONSTRAINT "contact_patient_link_guardianship_consistency"
  CHECK (
    (
      "relationship" = 'contact'
      AND "guardian_dui" IS NULL
      AND "guardianship_verification_status" IS NULL
    )
    OR (
      "relationship" = 'tutor'
      AND "guardian_dui" ~ '^[0-9]{8}-[0-9]$'
      AND "guardianship_verification_status" IN ('pending', 'verified')
    )
  );
