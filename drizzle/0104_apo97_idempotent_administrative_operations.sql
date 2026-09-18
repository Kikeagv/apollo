-- APO-97: make commercial mutations replayable and keep their audit atomic.
ALTER TABLE "pg-drizzle_transfer_payment"
  ADD COLUMN "operation_key" text;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_support_session"
  ADD COLUMN "operation_key" text;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_apolo_audit_event"
  ADD COLUMN "operation_key" text,
  ADD COLUMN "subscription_status" text;
--> statement-breakpoint
UPDATE "pg-drizzle_transfer_payment"
SET "operation_key" = 'legacy:transfer-payment:' || "id"::text
WHERE "operation_key" IS NULL;
--> statement-breakpoint
UPDATE "pg-drizzle_clinic_support_session"
SET "operation_key" = 'legacy:support-session:' || "id"::text
WHERE "operation_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_transfer_payment"
  ALTER COLUMN "operation_key" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_support_session"
  ALTER COLUMN "operation_key" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_payment_operation_key_unique"
  ON "pg-drizzle_transfer_payment" USING btree ("operation_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_support_session_operation_key_unique"
  ON "pg-drizzle_clinic_support_session" USING btree ("operation_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "apolo_audit_event_operation_key_unique"
  ON "pg-drizzle_apolo_audit_event" USING btree ("operation_key");
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "pg-drizzle_apolo_audit_event"
  TO apolo_commercial_access;
