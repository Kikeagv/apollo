CREATE OR REPLACE FUNCTION guard_whatsapp_connection_circuit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.whatsapp_template_delivery_worker', true) = 'true' THEN
    IF NOT COALESCE(
      public.apolo_whatsapp_template_delivery_actor_authorized(),
      false
    )
      OR NEW."clinic_id" IS DISTINCT FROM OLD."clinic_id"
      OR NEW."clinic_id" IS DISTINCT FROM NULLIF(
        current_setting('app.clinic_id', true),
        ''
      )::uuid
      OR NEW."connection_type" IS DISTINCT FROM OLD."connection_type"
      OR NEW."customer" IS DISTINCT FROM OLD."customer"
      OR NEW."business_account_id" IS DISTINCT FROM OLD."business_account_id"
      OR NEW."last_test_at" IS DISTINCT FROM OLD."last_test_at"
      OR NEW."phone_number_e164" IS DISTINCT FROM OLD."phone_number_e164"
      OR NEW."phone_number_id" IS DISTINCT FROM OLD."phone_number_id"
      OR OLD."provider" <> 'kapso'
      OR NEW."provider" <> 'kapso'
      OR OLD."status" <> 'ready'
      OR NEW."status" IS DISTINCT FROM OLD."status"
      OR OLD."real_traffic_status" <> 'blocked'
      OR NEW."real_traffic_status" <> 'enabled'
      OR NEW."real_traffic_enabled_at" IS NULL
      OR NEW."real_traffic_enabled_by_identity_id" IS DISTINCT FROM NULLIF(
        current_setting('app.superadmin_id', true),
        ''
      )
      OR NEW."offboarding_authorized_at" IS DISTINCT FROM OLD."offboarding_authorized_at"
      OR NEW."offboarding_authorized_by_identity_id" IS DISTINCT FROM OLD."offboarding_authorized_by_identity_id"
      OR NEW."metadata" IS DISTINCT FROM OLD."metadata"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    THEN
      RAISE EXCEPTION 'El worker de entrega de plantilla sólo puede habilitar tráfico real autorizado';
    END IF;
    RETURN NEW;
  END IF;

  IF (
    current_setting('app.whatsapp_inbound_worker', true) = 'true'
    OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
    OR current_setting('app.whatsapp_delivery_status_worker', true) = 'true'
  )
    AND (
      NEW."clinic_id" IS DISTINCT FROM OLD."clinic_id"
      OR NEW."connection_type" IS DISTINCT FROM OLD."connection_type"
      OR NEW."customer" IS DISTINCT FROM OLD."customer"
      OR NEW."business_account_id" IS DISTINCT FROM OLD."business_account_id"
      OR NEW."last_test_at" IS DISTINCT FROM OLD."last_test_at"
      OR NEW."phone_number_e164" IS DISTINCT FROM OLD."phone_number_e164"
      OR NEW."phone_number_id" IS DISTINCT FROM OLD."phone_number_id"
      OR NEW."provider" IS DISTINCT FROM OLD."provider"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
      OR NEW."status" <> 'blocked'
    )
  THEN
    RAISE EXCEPTION 'El worker de circuito sólo puede actualizar el estado operativo de WhatsApp';
  END IF;
  RETURN NEW;
END;
$$;
