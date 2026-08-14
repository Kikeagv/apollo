ALTER TABLE "pg-drizzle_conversation_escalation"
  DROP CONSTRAINT "conversation_escalation_contact_same_clinic_fk",
  ADD CONSTRAINT "conversation_escalation_contact_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "contact_id")
    REFERENCES "pg-drizzle_contact" ("clinic_id", "id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_conversation_event"
  DROP CONSTRAINT "conversation_event_contact_same_clinic_fk",
  ADD CONSTRAINT "conversation_event_contact_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "contact_id")
    REFERENCES "pg-drizzle_contact" ("clinic_id", "id") ON DELETE CASCADE;
