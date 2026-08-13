CREATE TABLE "pg-drizzle_appointment_self_management_escalation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"action" text NOT NULL,
	"requested_starts_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment_self_management_escalation" ADD CONSTRAINT "appointment_self_management_escalation_appointment_same_clinic_fk" FOREIGN KEY ("clinic_id","appointment_id") REFERENCES "public"."pg-drizzle_appointment"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment_self_management_escalation" ADD CONSTRAINT "appointment_self_management_escalation_contact_same_clinic_fk" FOREIGN KEY ("clinic_id","contact_id") REFERENCES "public"."pg-drizzle_contact"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_self_management_escalation_clinic_idx" ON "pg-drizzle_appointment_self_management_escalation" USING btree ("clinic_id","created_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_appointment_self_management_escalation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_appointment_self_management_escalation" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "appointment_self_management_escalation_operating_read"
  ON "pg-drizzle_appointment_self_management_escalation" FOR SELECT
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "appointment_self_management_escalation_whatsapp_append"
  ON "pg-drizzle_appointment_self_management_escalation" FOR INSERT
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.whatsapp_inbound', true) = 'true'
  );
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "pg-drizzle_appointment_self_management_escalation"
TO panacea_clinical_access;
