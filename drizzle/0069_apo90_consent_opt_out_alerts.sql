-- APO-90: make consent append-only across opt-in/opt-out decisions and
-- require human evidence when a failed delivery alert is resolved.
ALTER TABLE "pg-drizzle_whatsapp_contact_consent"
  ADD COLUMN "status" text DEFAULT 'accepted' NOT NULL,
  ADD CONSTRAINT "whatsapp_contact_consent_status"
    CHECK ("status" IN ('accepted', 'revoked'));
--> statement-breakpoint
DROP INDEX IF EXISTS "whatsapp_contact_consent_channel_version_unique";
--> statement-breakpoint
ALTER TABLE "pg-drizzle_transactional_delivery_alert"
  ADD COLUMN "resolution_evidence" text;
--> statement-breakpoint
UPDATE "pg-drizzle_transactional_delivery_alert"
SET "resolution_evidence" = 'Resolución histórica migrada; no existía evidencia registrada antes de APO-90.'
WHERE "resolved_at" IS NOT NULL
  AND btrim(COALESCE("resolution_evidence", '')) = '';
--> statement-breakpoint
ALTER TABLE "pg-drizzle_transactional_delivery_alert"
  ADD CONSTRAINT "transactional_delivery_alert_resolution_evidence"
    CHECK (
      "resolved_at" IS NULL
      OR btrim(COALESCE("resolution_evidence", '')) <> ''
    );
--> statement-breakpoint
DROP POLICY IF EXISTS "transactional_delivery_alert_clinic_resolve"
  ON "pg-drizzle_transactional_delivery_alert";
CREATE POLICY "transactional_delivery_alert_clinic_resolve"
  ON "pg-drizzle_transactional_delivery_alert"
  FOR UPDATE
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      "resolved_at" IS NULL
      OR btrim(COALESCE("resolution_evidence", '')) <> ''
    )
  );
