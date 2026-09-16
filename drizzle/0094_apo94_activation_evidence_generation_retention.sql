-- APO-94: una evidencia antigua no puede volverse vigente porque se eliminó
-- el evento que identificaba su generación.
ALTER TABLE "pg-drizzle_whatsapp_activation_evidence"
  DROP CONSTRAINT IF EXISTS "whatsapp_activation_evidence_provisioning_event_fk";
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_activation_evidence"
  ADD CONSTRAINT "whatsapp_activation_evidence_provisioning_event_fk"
  FOREIGN KEY ("provisioning_event_id")
  REFERENCES "pg-drizzle_whatsapp_webhook_event" ("id")
  ON DELETE RESTRICT;
