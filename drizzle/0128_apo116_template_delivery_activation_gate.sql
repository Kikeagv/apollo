CREATE POLICY "whatsapp_connection_template_delivery_worker_update"
  ON "pg-drizzle_whatsapp_connection"
  FOR UPDATE
  USING (
    current_setting('app.whatsapp_template_delivery_worker', true) = 'true'
    AND current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND "provider" = 'kapso'
    AND "status" = 'ready'
    AND "real_traffic_status" = 'blocked'
  )
  WITH CHECK (
    current_setting('app.whatsapp_template_delivery_worker', true) = 'true'
    AND current_setting('app.whatsapp_outbound_worker', true) = 'true'
    AND "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND "provider" = 'kapso'
    AND "status" = 'ready'
    AND "real_traffic_status" = 'enabled'
    AND EXISTS (
      SELECT 1
      FROM "pg-drizzle_clinic" AS activation_clinic
      JOIN "pg-drizzle_whatsapp_readiness" AS activation_readiness
        ON activation_readiness."clinic_id" = activation_clinic."id"
      JOIN "pg-drizzle_whatsapp_smoke_run" AS inbound_smoke
        ON inbound_smoke."clinic_id" = activation_clinic."id"
      JOIN "pg-drizzle_whatsapp_circuit_breaker" AS activation_circuit
        ON activation_circuit."clinic_id" = activation_clinic."id"
      WHERE activation_clinic."id" = "pg-drizzle_whatsapp_connection"."clinic_id"
        AND activation_clinic."is_synthetic" = false
        AND activation_readiness."technical_status" = 'ready'
        AND activation_readiness."phone_number_id" = "pg-drizzle_whatsapp_connection"."phone_number_id"
        AND activation_readiness."provisioning_event_id"::text = "pg-drizzle_whatsapp_connection"."metadata" ->> 'provisioningEventId'
        AND inbound_smoke."id" = (
          SELECT latest_smoke."id"
          FROM "pg-drizzle_whatsapp_smoke_run" AS latest_smoke
          WHERE latest_smoke."clinic_id" = activation_clinic."id"
          ORDER BY latest_smoke."started_at" DESC, latest_smoke."id" DESC
          LIMIT 1
        )
        AND inbound_smoke."status" = 'passed'
        AND inbound_smoke."requires_real_roundtrip" = true
        AND inbound_smoke."provider_transport_verified" = true
        AND inbound_smoke."real_patients_enabled" = false
        AND inbound_smoke."synthetic_contact" = false
        AND inbound_smoke."test_contact_id" IS NOT NULL
        AND inbound_smoke."provisioning_event_id"::text = "pg-drizzle_whatsapp_connection"."metadata" ->> 'provisioningEventId'
        AND activation_circuit."status" = 'closed'
        AND NOT EXISTS (
          SELECT 1
          FROM "pg-drizzle_contact_patient_link" AS test_contact_link
          WHERE test_contact_link."clinic_id" = inbound_smoke."clinic_id"
            AND test_contact_link."contact_id" = inbound_smoke."test_contact_id"
        )
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(inbound_smoke."steps") AS delivery_step(step_json)
          JOIN "pg-drizzle_whatsapp_critical_template" AS approved_template
            ON approved_template."clinic_id" = inbound_smoke."clinic_id"
            AND approved_template."kind" = delivery_step.step_json ->> 'templateKind'
            AND approved_template."name" = delivery_step.step_json ->> 'templateName'
            AND approved_template."provider_template_id" = delivery_step.step_json ->> 'providerTemplateId'
            AND approved_template."catalog_version"::text = delivery_step.step_json ->> 'templateCatalogVersion'
            AND approved_template."locale" = delivery_step.step_json ->> 'templateLocale'
            AND approved_template."provisioning_event_id" = inbound_smoke."provisioning_event_id"
            AND approved_template."category" = 'UTILITY'
            AND approved_template."status" = 'APPROVED'
            AND approved_template."provisioning_status" = 'approved'
          JOIN "pg-drizzle_whatsapp_contact_consent" AS current_consent
            ON current_consent."clinic_id" = inbound_smoke."clinic_id"
            AND current_consent."contact_id" = inbound_smoke."test_contact_id"
            AND current_consent."id"::text = delivery_step.step_json ->> 'consentReference'
            AND current_consent."accepted_at" = (delivery_step.step_json ->> 'consentAcceptedAt')::timestamptz
            AND current_consent."terms_version" = delivery_step.step_json ->> 'consentTermsVersion'
            AND current_consent."privacy_version" = delivery_step.step_json ->> 'consentPrivacyVersion'
            AND current_consent."text_reference" = delivery_step.step_json ->> 'consentTextReference'
          WHERE delivery_step.step_json ->> 'code' = 'real-template-delivery'
            AND delivery_step.step_json ->> 'status' = 'passed'
            AND delivery_step.step_json ->> 'passed' = 'true'
            AND delivery_step.step_json ->> 'source' = 'provider'
            AND delivery_step.step_json ->> 'providerMessageId' <> ''
            AND current_consent."scope" = 'contact'
            AND current_consent."patient_id" IS NULL
            AND current_consent."accepted_role" = 'contact'
            AND current_consent."provider" = 'kapso'
            AND current_consent."status" = 'accepted'
            AND current_consent."privacy_version" = '1.0'
            AND current_consent."accepted_at" <= clock_timestamp()
            AND NOT EXISTS (
              SELECT 1
              FROM "pg-drizzle_whatsapp_contact_consent" AS newer_consent
              WHERE newer_consent."clinic_id" = current_consent."clinic_id"
                AND newer_consent."contact_id" = current_consent."contact_id"
                AND newer_consent."scope" = 'contact'
                AND newer_consent."patient_id" IS NULL
                AND (
                  newer_consent."accepted_at" > current_consent."accepted_at"
                  OR (
                    newer_consent."accepted_at" = current_consent."accepted_at"
                    AND newer_consent."created_at" > current_consent."created_at"
                  )
                  OR (
                    newer_consent."accepted_at" = current_consent."accepted_at"
                    AND newer_consent."created_at" = current_consent."created_at"
                    AND newer_consent."id" > current_consent."id"
                  )
                )
            )
        )
    )
  );
