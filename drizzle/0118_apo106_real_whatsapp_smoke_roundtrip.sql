-- APO-106: persiste pruebas reales de transporte y sus pasos hasta el callback.
ALTER TABLE "pg-drizzle_whatsapp_smoke_run"
  ALTER COLUMN "finished_at" DROP NOT NULL,
  ADD COLUMN "requires_real_roundtrip" boolean DEFAULT false NOT NULL,
  ADD COLUMN "test_contact_id" uuid,
  ADD COLUMN "test_contact_masked_phone" text,
  ADD COLUMN "timeout_at" timestamp with time zone,
  ADD COLUMN "timed_out_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_smoke_run"
  DROP CONSTRAINT "whatsapp_smoke_run_status",
  DROP CONSTRAINT "whatsapp_smoke_run_result_safety",
  ADD CONSTRAINT "whatsapp_smoke_run_status"
    CHECK ("status" IN ('failed', 'passed', 'pending')),
  ADD CONSTRAINT "whatsapp_smoke_run_test_contact_fk"
    FOREIGN KEY ("clinic_id", "test_contact_id")
    REFERENCES "pg-drizzle_contact" ("clinic_id", "id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "whatsapp_smoke_run_result_safety"
    CHECK (
      "status" = 'failed'
      OR (
        "real_patients_enabled" = false
        AND (
          "synthetic_contact" = true
          OR ("requires_real_roundtrip" = true AND "test_contact_id" IS NOT NULL)
        )
      )
    ),
  ADD CONSTRAINT "whatsapp_smoke_run_roundtrip_result_safety"
    CHECK (
      NOT "requires_real_roundtrip"
      OR "status" <> 'passed'
      OR (
        "provider_transport_verified" = true
        AND "test_contact_id" IS NOT NULL
        AND "test_contact_masked_phone" IS NOT NULL
        AND "real_patients_enabled" = false
      )
    ),
  ADD CONSTRAINT "whatsapp_smoke_run_completion"
    CHECK (
      ("status" = 'pending' AND "finished_at" IS NULL AND "timeout_at" IS NOT NULL)
      OR ("status" <> 'pending' AND "finished_at" IS NOT NULL)
    );
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_smoke_run_one_pending_per_clinic"
  ON "pg-drizzle_whatsapp_smoke_run" USING btree ("clinic_id")
  WHERE "status" = 'pending';
--> statement-breakpoint
CREATE POLICY "whatsapp_smoke_run_worker_read"
  ON "pg-drizzle_whatsapp_smoke_run"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
  );
CREATE POLICY "whatsapp_smoke_run_worker_update"
  ON "pg-drizzle_whatsapp_smoke_run"
  FOR UPDATE
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
  )
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND (
      current_setting('app.whatsapp_inbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
      OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
    )
  );
