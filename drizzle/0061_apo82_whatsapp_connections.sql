CREATE TABLE "pg-drizzle_whatsapp_connection" (
  "clinic_id" uuid PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "status" text NOT NULL,
  "connection_type" text NOT NULL,
  "customer" text NOT NULL,
  "phone_number_id" text,
  "phone_number_e164" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_test_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_connection_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "pg-drizzle_clinic" ("id")
    ON DELETE cascade,
  CONSTRAINT "whatsapp_connection_provider"
    CHECK ("provider" IN ('simulated', 'kapso')),
  CONSTRAINT "whatsapp_connection_status"
    CHECK ("status" IN ('pending', 'provisioning', 'ready', 'degraded', 'blocked', 'disconnected')),
  CONSTRAINT "whatsapp_connection_type"
    CHECK ("connection_type" IN ('simulated', 'coexistence')),
  CONSTRAINT "whatsapp_connection_provider_type"
    CHECK (
      ("provider" = 'simulated' AND "connection_type" = 'simulated')
      OR ("provider" = 'kapso' AND "connection_type" = 'coexistence')
    ),
  CONSTRAINT "whatsapp_connection_customer_not_blank"
    CHECK (btrim("customer") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_connection_customer_unique"
  ON "pg-drizzle_whatsapp_connection" USING btree ("customer");
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_connection_phone_number_id_unique"
  ON "pg-drizzle_whatsapp_connection" USING btree ("phone_number_id")
  WHERE "phone_number_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_connection_phone_number_e164_unique"
  ON "pg-drizzle_whatsapp_connection" USING btree ("phone_number_e164")
  WHERE "phone_number_e164" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "pg-drizzle_whatsapp_connection" (
  "clinic_id",
  "provider",
  "status",
  "connection_type",
  "customer",
  "phone_number_e164",
  "metadata"
)
SELECT
  "id",
  'simulated',
  'ready',
  'simulated',
  'simulated:' || "id"::text,
  "whatsapp_number_e164",
  '{"mode":"simulated","source":"migration"}'::jsonb
FROM "pg-drizzle_clinic"
ON CONFLICT ("clinic_id") DO NOTHING;
--> statement-breakpoint
DROP POLICY IF EXISTS "clinic_whatsapp_inbound_lookup"
  ON "pg-drizzle_clinic";
DROP INDEX IF EXISTS "clinic_whatsapp_number_e164_unique";
ALTER TABLE "pg-drizzle_clinic"
  DROP COLUMN "whatsapp_number_e164";
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_connection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_connection" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "pg-drizzle_whatsapp_connection"
TO panacea_clinical_access;
GRANT SELECT ON TABLE
  "pg-drizzle_whatsapp_connection"
TO apolo_commercial_access;
--> statement-breakpoint
CREATE POLICY "whatsapp_connection_clinic_read"
  ON "pg-drizzle_whatsapp_connection"
  FOR SELECT
  USING (
    (
      "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
      AND current_setting('app.clinic_role', true) = 'owner'
    )
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_connection_inbound_lookup"
  ON "pg-drizzle_whatsapp_connection"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_inbound', true) = 'true'
    AND "phone_number_e164" = NULLIF(
      current_setting('app.whatsapp_inbound_phone_e164', true),
      ''
    )
    AND "provider" = 'simulated'
    AND "status" = 'ready'
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_connection_provider_read"
  ON "pg-drizzle_whatsapp_connection"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_provider', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_connection_subscription_active_read"
  ON "pg-drizzle_whatsapp_connection"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_inbound', true) = 'true'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_connection_superadmin_manage"
  ON "pg-drizzle_whatsapp_connection"
  FOR ALL
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
--> statement-breakpoint
CREATE POLICY "whatsapp_connection_subscription_active_insert"
  ON "pg-drizzle_whatsapp_connection"
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    OR current_setting('app.subscription_status', true) = 'active'
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_connection_subscription_active_update"
  ON "pg-drizzle_whatsapp_connection"
  AS RESTRICTIVE
  FOR UPDATE
  USING (
    NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    OR current_setting('app.subscription_status', true) = 'active'
  )
  WITH CHECK (
    NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    OR current_setting('app.subscription_status', true) = 'active'
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_connection_subscription_active_delete"
  ON "pg-drizzle_whatsapp_connection"
  AS RESTRICTIVE
  FOR DELETE
  USING (
    NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
    OR current_setting('app.subscription_status', true) = 'active'
  );
--> statement-breakpoint
CREATE POLICY "clinic_whatsapp_connection_inbound_lookup"
  ON "pg-drizzle_clinic"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_inbound', true) = 'true'
    AND EXISTS (
      SELECT 1
      FROM "pg-drizzle_whatsapp_connection" AS connection
      WHERE connection."clinic_id" = "pg-drizzle_clinic"."id"
        AND connection."phone_number_e164" = NULLIF(
          current_setting('app.whatsapp_inbound_phone_e164', true),
          ''
        )
        AND connection."provider" = 'simulated'
        AND connection."status" = 'ready'
    )
  );
