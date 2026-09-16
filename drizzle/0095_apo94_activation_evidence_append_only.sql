-- APO-94: conservar cada registro de evidencia como historial append-only;
-- la lectura del contrato selecciona la última fila por criterio y fuente.
DROP INDEX IF EXISTS "whatsapp_activation_evidence_clinic_criterion_source_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "whatsapp_activation_evidence_clinic_criterion_source_idx";
--> statement-breakpoint
CREATE INDEX "whatsapp_activation_evidence_clinic_criterion_source_idx"
  ON "pg-drizzle_whatsapp_activation_evidence"
  USING btree ("clinic_id", "criterion_code", "source", "updated_at");
