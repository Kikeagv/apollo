ALTER TABLE "pg-drizzle_clinic"
  ADD COLUMN "escalation_notifications_enabled" boolean DEFAULT false NOT NULL,
  ADD COLUMN "escalation_secretary_phone_e164" text;
--> statement-breakpoint
CREATE TABLE "pg-drizzle_conversation_escalation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "trigger" text NOT NULL CHECK ("trigger" IN ('human-request', 'frustration', 'misunderstanding')),
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_escalation_contact_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "contact_id")
    REFERENCES "pg-drizzle_contact" ("clinic_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "conversation_escalation_clinic_idx"
  ON "pg-drizzle_conversation_escalation" USING btree ("clinic_id", "created_at");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_conversation_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "type" text NOT NULL CHECK ("type" IN ('urgency-protocol')),
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_event_contact_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "contact_id")
    REFERENCES "pg-drizzle_contact" ("clinic_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "conversation_event_clinic_idx"
  ON "pg-drizzle_conversation_event" USING btree ("clinic_id", "occurred_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_conversation_escalation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_conversation_escalation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_conversation_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_conversation_event" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "conversation_escalation_whatsapp_append"
  ON "pg-drizzle_conversation_escalation" FOR INSERT
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.whatsapp_inbound', true) = 'true'
  );
CREATE POLICY "conversation_escalation_operating_read"
  ON "pg-drizzle_conversation_escalation" FOR SELECT
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
CREATE POLICY "conversation_escalation_operating_resolve"
  ON "pg-drizzle_conversation_escalation" FOR UPDATE
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
CREATE POLICY "conversation_event_whatsapp_append"
  ON "pg-drizzle_conversation_event" FOR INSERT
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.whatsapp_inbound', true) = 'true'
  );
CREATE POLICY "conversation_event_operating_read"
  ON "pg-drizzle_conversation_event" FOR SELECT
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "pg-drizzle_conversation_escalation"
  TO panacea_clinical_access;
GRANT SELECT, INSERT ON TABLE "pg-drizzle_conversation_event"
  TO panacea_clinical_access;
