CREATE TABLE "pg-drizzle_clinic_terms_contract" (
  "id" boolean PRIMARY KEY DEFAULT true NOT NULL,
  "current_version" text NOT NULL,
  CONSTRAINT "clinic_terms_contract_singleton" CHECK ("id"),
  CONSTRAINT "clinic_terms_contract_version" CHECK (btrim("current_version") <> '')
);
--> statement-breakpoint
INSERT INTO "pg-drizzle_clinic_terms_contract" ("id", "current_version")
VALUES (true, '1.0');
--> statement-breakpoint
GRANT SELECT ON TABLE "pg-drizzle_clinic_terms_contract"
  TO panacea_clinical_access;
--> statement-breakpoint
CREATE FUNCTION "clinic_terms_version_is_current"("accepted_version" text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    $1 = (
      SELECT "current_version"
      FROM "public"."pg-drizzle_clinic_terms_contract"
      WHERE "id" = true
    ),
    false
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "clinic_terms_acceptance_is_current"(
  "accepted_at" timestamp with time zone,
  "accepted_version" text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT $1 IS NOT NULL
    AND "public"."clinic_terms_version_is_current"($2);
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "clinic_readiness_validate_terms_acceptance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  acceptance_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    acceptance_changed := true;
  ELSE
    acceptance_changed := OLD."asclepio_enabled" IS NOT TRUE
       OR NEW."terms_accepted_at" IS DISTINCT FROM OLD."terms_accepted_at"
       OR NEW."terms_accepted_by_identity_id" IS DISTINCT FROM OLD."terms_accepted_by_identity_id"
       OR NEW."terms_accepted_version" IS DISTINCT FROM OLD."terms_accepted_version";
  END IF;
  IF NEW."asclepio_enabled"
     AND acceptance_changed
     AND NOT "public"."clinic_terms_acceptance_is_current"(
       NEW."terms_accepted_at", NEW."terms_accepted_version"
     )
  THEN
    RAISE EXCEPTION USING ERRCODE = 'PT001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER POLICY "clinic_readiness_owner_insert"
  ON "pg-drizzle_clinic_readiness"
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.clinic_role', true) = 'owner'
      OR current_setting('app.readiness_recalculation', true) = 'true'
      OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    )
  );
