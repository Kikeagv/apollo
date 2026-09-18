-- Reparación forward-only para instalaciones que ya registraron APO-96 (0102).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "pg-drizzle_clinic_user"
    GROUP BY "clinic_id", "identity_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'APO-96 no puede garantizar un acceso único: existen relaciones duplicadas';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "pg-drizzle_clinic_user"
    WHERE "role" = 'owner'
    GROUP BY "clinic_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'APO-96 no puede garantizar un propietario único: existe más de un propietario por Clínica';
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
REVOKE SELECT ON TABLE "account"
  FROM panacea_clinical_access;
