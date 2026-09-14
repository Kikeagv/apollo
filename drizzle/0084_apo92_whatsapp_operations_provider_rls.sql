-- APO-92: el guard de salida lee las evidencias bajo el contexto del proveedor.
GRANT SELECT ON TABLE
  "pg-drizzle_whatsapp_traffic_gate_evidence",
  "pg-drizzle_whatsapp_smoke_run"
  TO panacea_clinical_access;
--> statement-breakpoint
CREATE POLICY "whatsapp_traffic_gate_evidence_provider_read"
  ON "pg-drizzle_whatsapp_traffic_gate_evidence"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_provider', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
CREATE POLICY "whatsapp_smoke_run_provider_read"
  ON "pg-drizzle_whatsapp_smoke_run"
  FOR SELECT
  USING (
    current_setting('app.whatsapp_provider', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
