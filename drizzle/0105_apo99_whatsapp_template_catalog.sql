-- APO-99: persist the versioned catalog and per-WABA provisioning state.
ALTER TABLE "pg-drizzle_whatsapp_critical_template"
  ADD COLUMN "catalog_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "content" text DEFAULT '' NOT NULL,
  ADD COLUMN "examples" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN "provisioning_status" text DEFAULT 'missing' NOT NULL;
--> statement-breakpoint
UPDATE "pg-drizzle_whatsapp_critical_template"
SET
  "content" = CASE "kind"
    WHEN 'confirmation' THEN 'Hola {{patient_name}}, tu cita en {{clinic_name}} es el {{appointment_date}} a las {{appointment_time}} con {{doctor_name}}.'
    WHEN 'reminder' THEN 'Recordatorio: {{patient_name}}, tu cita en {{clinic_name}} es el {{appointment_date}} a las {{appointment_time}} con {{doctor_name}}.'
    WHEN 'cancellation' THEN '{{patient_name}}, tu cita en {{clinic_name}} del {{appointment_date}} a las {{appointment_time}} con {{doctor_name}} fue cancelada.'
    WHEN 'reschedule' THEN '{{patient_name}}, tu cita en {{clinic_name}} fue reprogramada para el {{appointment_date}} a las {{appointment_time}} con {{doctor_name}}.'
    ELSE ''
  END,
  "examples" = jsonb_build_object(
    'appointment_date', '25 de septiembre de 2026',
    'appointment_time', '08:30',
    'clinic_name', 'Clínica Central',
    'doctor_name', 'Dra. Ana López',
    'patient_name', 'María Hernández'
  ),
  "provisioning_status" = CASE "status"
    WHEN 'APPROVED' THEN 'approved'
    WHEN 'REJECTED' THEN 'rejected'
    WHEN 'DISABLED' THEN 'rejected'
    ELSE 'in_review'
  END;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_critical_template"
  ADD CONSTRAINT "whatsapp_critical_template_catalog_version"
    CHECK ("catalog_version" > 0),
  ADD CONSTRAINT "whatsapp_critical_template_provisioning_status"
    CHECK ("provisioning_status" IN ('missing', 'submitted', 'in_review', 'approved', 'rejected'));
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_critical_template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_critical_template" FORCE ROW LEVEL SECURITY;
