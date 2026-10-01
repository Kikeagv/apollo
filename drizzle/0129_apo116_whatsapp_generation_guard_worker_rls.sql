-- APO-116: the inbound worker must update smoke evidence while its RLS role
-- cannot directly read provisioning-generation rows. Keep the ownership check
-- in the trigger, but run that narrow existence check with the function owner.
CREATE OR REPLACE FUNCTION whatsapp_generation_clinic_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.provisioning_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."pg-drizzle_whatsapp_provisioning_step"
    WHERE event_id = NEW.provisioning_event_id
      AND clinic_id = NEW.clinic_id
  ) OR EXISTS (
    SELECT 1
    FROM public."pg-drizzle_whatsapp_readiness"
    WHERE clinic_id = NEW.clinic_id
      AND provisioning_event_id = NEW.provisioning_event_id
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'La generación de provisión de WhatsApp no pertenece a la Clínica';
END;
$$;
