ALTER POLICY "clinic_owner_updates_no_show_policy"
  ON "pg-drizzle_clinic"
  RENAME TO "clinic_owner_updates_whatsapp_policies";
--> statement-breakpoint
DROP POLICY "clinic_isolation" ON "pg-drizzle_clinic";
--> statement-breakpoint
CREATE POLICY "clinic_isolation" ON "pg-drizzle_clinic"
  FOR SELECT
  USING ("id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
REVOKE UPDATE ON TABLE "pg-drizzle_clinic" FROM panacea_clinical_access;
--> statement-breakpoint
GRANT UPDATE (
  "no_show_policy",
  "escalation_notifications_enabled",
  "escalation_secretary_phone_e164",
  "voice_transcription_enabled"
) ON TABLE "pg-drizzle_clinic" TO panacea_clinical_access;
--> statement-breakpoint
UPDATE "pg-drizzle_clinic"
SET "escalation_secretary_phone_e164" = NULLIF(
  btrim("escalation_secretary_phone_e164"),
  ''
)
WHERE "escalation_secretary_phone_e164" IS NOT NULL
  AND "escalation_secretary_phone_e164" IS DISTINCT FROM NULLIF(
    btrim("escalation_secretary_phone_e164"),
    ''
  );
--> statement-breakpoint
UPDATE "pg-drizzle_clinic"
SET "escalation_secretary_phone_e164" = NULL
WHERE "escalation_secretary_phone_e164" IS NOT NULL
  AND "escalation_secretary_phone_e164" !~ '^\+[1-9][0-9]{1,14}$';
--> statement-breakpoint
UPDATE "pg-drizzle_clinic"
SET "escalation_notifications_enabled" = false
WHERE "escalation_notifications_enabled"
  AND "escalation_secretary_phone_e164" IS NULL;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic"
  ADD CONSTRAINT "clinic_escalation_secretary_phone_e164"
    CHECK (
      "escalation_secretary_phone_e164" IS NULL
      OR "escalation_secretary_phone_e164" ~ '^\+[1-9][0-9]{1,14}$'
    ),
  ADD CONSTRAINT "clinic_escalation_notification_recipient"
    CHECK (
      NOT "escalation_notifications_enabled"
      OR "escalation_secretary_phone_e164" IS NOT NULL
    );
