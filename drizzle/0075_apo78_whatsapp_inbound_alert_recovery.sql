-- APO-78: record the Apolo operator that requeues an inbound alert.
ALTER TABLE "pg-drizzle_whatsapp_inbound_alert"
  ADD COLUMN "resolved_by_identity_id" text;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_inbound_alert"
  ADD CONSTRAINT "whatsapp_inbound_alert_resolved_by_identity_fk"
    FOREIGN KEY ("resolved_by_identity_id")
    REFERENCES "user" ("id") ON DELETE restrict;
