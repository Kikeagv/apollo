-- APO-78: make booking side effects replay-safe after a worker crash.
ALTER TABLE "pg-drizzle_temporary_reservation"
  ADD COLUMN "source_message_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "temporary_reservation_source_message_unique"
  ON "pg-drizzle_temporary_reservation" USING btree
  ("clinic_id", "source_message_id")
  WHERE "source_message_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment"
  ADD COLUMN "source_message_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_source_message_unique"
  ON "pg-drizzle_appointment" USING btree
  ("clinic_id", "source_message_id")
  WHERE "source_message_id" IS NOT NULL;
