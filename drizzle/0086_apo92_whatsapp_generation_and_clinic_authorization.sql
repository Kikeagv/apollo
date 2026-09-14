-- APO-92: bind smoke evidence to a provisioning generation and require
-- explicit authorization from the Clinic owner before offboarding.
ALTER TABLE "pg-drizzle_whatsapp_connection"
  ADD COLUMN "offboarding_authorized_at" timestamp with time zone,
  ADD COLUMN "offboarding_authorized_by_identity_id" text;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_connection"
  ADD CONSTRAINT "whatsapp_connection_offboarding_authorized_by_identity_fk"
    FOREIGN KEY ("offboarding_authorized_by_identity_id") REFERENCES "user" ("id")
    ON DELETE SET NULL;
--> statement-breakpoint
-- The provisioning worker already owns UPDATE through its RLS policy. Keep
-- that table privilege and constrain clinic-owner sessions with a trigger so
-- the worker can continue updating the connection state.
GRANT UPDATE ON TABLE "pg-drizzle_whatsapp_connection"
  TO panacea_clinical_access;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION whatsapp_connection_owner_authorization_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('app.clinic_role', true), '') = 'owner'
     AND coalesce(current_setting('app.whatsapp_provisioning_worker', true), '') <> 'true'
     AND (
       (to_jsonb(NEW) - 'offboarding_authorized_at' - 'offboarding_authorized_by_identity_id')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'offboarding_authorized_at' - 'offboarding_authorized_by_identity_id')
     )
  THEN
    RAISE EXCEPTION 'El propietario solo puede actualizar la autorización de offboarding';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER whatsapp_connection_owner_authorization_guard
  BEFORE UPDATE ON "pg-drizzle_whatsapp_connection"
  FOR EACH ROW
  EXECUTE FUNCTION whatsapp_connection_owner_authorization_guard();
--> statement-breakpoint
CREATE POLICY "whatsapp_connection_clinic_owner_authorize_offboarding"
  ON "pg-drizzle_whatsapp_connection"
  FOR UPDATE
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  )
  WITH CHECK (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
    AND "offboarding_authorized_at" IS NOT NULL
    AND "offboarding_authorized_by_identity_id" = NULLIF(current_setting('app.identity_id', true), '')
  );
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_onboarding_audit_event"
  DROP CONSTRAINT "whatsapp_onboarding_audit_action";
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_onboarding_audit_event"
  ADD CONSTRAINT "whatsapp_onboarding_audit_action"
    CHECK ("action" IN ('customer-confirmed', 'customer-created', 'onboarding-provider-unavailable', 'preflight-executed', 'setup-link-confirmed', 'setup-link-created', 'setup-link-expired', 'setup-link-provider-unavailable', 'setup-link-regenerated', 'setup-link-revoked', 'setup-link-used', 'offboarding-authorized'));
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_smoke_run"
  ADD COLUMN "provisioning_event_id" uuid;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_smoke_run"
  ADD CONSTRAINT "whatsapp_smoke_run_provisioning_event_fk"
    FOREIGN KEY ("provisioning_event_id") REFERENCES "pg-drizzle_whatsapp_webhook_event" ("id")
    ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "whatsapp_smoke_run_generation_idx"
  ON "pg-drizzle_whatsapp_smoke_run" USING btree ("clinic_id", "provisioning_event_id", "finished_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_offboarding_run"
  ADD COLUMN "provisioning_event_id" uuid;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_offboarding_run"
  ADD CONSTRAINT "whatsapp_offboarding_run_provisioning_event_fk"
    FOREIGN KEY ("provisioning_event_id") REFERENCES "pg-drizzle_whatsapp_webhook_event" ("id")
    ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "whatsapp_offboarding_run_generation_idx"
  ON "pg-drizzle_whatsapp_offboarding_run" USING btree ("clinic_id", "provisioning_event_id", "started_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION whatsapp_generation_clinic_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provisioning_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "pg-drizzle_whatsapp_provisioning_step"
    WHERE event_id = NEW.provisioning_event_id
      AND clinic_id = NEW.clinic_id
  ) OR EXISTS (
    SELECT 1
    FROM "pg-drizzle_whatsapp_readiness"
    WHERE clinic_id = NEW.clinic_id
      AND provisioning_event_id = NEW.provisioning_event_id
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'La generación de provisión de WhatsApp no pertenece a la Clínica';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER whatsapp_smoke_run_generation_clinic_guard
  BEFORE INSERT OR UPDATE ON "pg-drizzle_whatsapp_smoke_run"
  FOR EACH ROW
  EXECUTE FUNCTION whatsapp_generation_clinic_guard();
--> statement-breakpoint
CREATE TRIGGER whatsapp_offboarding_run_generation_clinic_guard
  BEFORE INSERT OR UPDATE ON "pg-drizzle_whatsapp_offboarding_run"
  FOR EACH ROW
  EXECUTE FUNCTION whatsapp_generation_clinic_guard();
