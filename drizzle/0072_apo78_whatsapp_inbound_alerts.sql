-- APO-78: retain a global operational alert when a Kapso inbound event
-- cannot be safely assigned to a Clinic.
CREATE TABLE "pg-drizzle_whatsapp_inbound_alert" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "inbound_message_id" uuid NOT NULL,
  "phone_number_id" text NOT NULL,
  "customer_id" text,
  "reason" text NOT NULL,
  "next_action" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_inbound_alert_message_fk"
    FOREIGN KEY ("inbound_message_id")
    REFERENCES "pg-drizzle_whatsapp_inbound_message" ("id") ON DELETE cascade,
  CONSTRAINT "whatsapp_inbound_alert_status"
    CHECK ("status" IN ('open', 'resolved')),
  CONSTRAINT "whatsapp_inbound_alert_reason_not_blank"
    CHECK (btrim("reason") <> ''),
  CONSTRAINT "whatsapp_inbound_alert_next_action_not_blank"
    CHECK (btrim("next_action") <> ''),
  CONSTRAINT "whatsapp_inbound_alert_resolution"
    CHECK ("status" = 'open' OR "resolved_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_inbound_alert_message_unique"
  ON "pg-drizzle_whatsapp_inbound_alert" USING btree ("inbound_message_id");
CREATE INDEX "whatsapp_inbound_alert_status_idx"
  ON "pg-drizzle_whatsapp_inbound_alert"
  USING btree ("status", "updated_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_inbound_alert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_inbound_alert" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "pg-drizzle_whatsapp_inbound_alert"
  TO panacea_clinical_access;
--> statement-breakpoint
CREATE POLICY "whatsapp_inbound_alert_worker_append"
  ON "pg-drizzle_whatsapp_inbound_alert"
  FOR INSERT
  WITH CHECK (current_setting('app.whatsapp_inbound_worker', true) = 'true');
CREATE POLICY "whatsapp_inbound_alert_superadmin_read"
  ON "pg-drizzle_whatsapp_inbound_alert"
  FOR SELECT
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_inbound_alert_superadmin_resolve"
  ON "pg-drizzle_whatsapp_inbound_alert"
  FOR UPDATE
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
