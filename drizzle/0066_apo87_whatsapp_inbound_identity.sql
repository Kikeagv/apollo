ALTER TABLE "pg-drizzle_whatsapp_webhook_event"
  DROP CONSTRAINT "whatsapp_webhook_event_name";
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_webhook_event"
  ADD CONSTRAINT "whatsapp_webhook_event_name"
  CHECK ("event_name" IN (
    'whatsapp.phone_number.created',
    'whatsapp.phone_number.deleted',
    'whatsapp.message.received',
    'whatsapp.message.sent',
    'whatsapp.message.delivered',
    'whatsapp.message.read',
    'whatsapp.message.failed',
    'whatsapp.conversation.created',
    'whatsapp.conversation.ended',
    'whatsapp.conversation.inactive',
    'whatsapp.contact.identity_changed'
  ));
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_identity" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "contact_id" uuid,
  "phone_number_id" text NOT NULL,
  "wa_id" text,
  "phone_e164" text,
  "business_scoped_user_id" text,
  "parent_business_scoped_user_id" text,
  "username" text,
  "status" text NOT NULL,
  "observed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source_message_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_identity_clinic_id_unique" UNIQUE ("clinic_id", "id"),
  CONSTRAINT "whatsapp_identity_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "pg-drizzle_clinic" ("id") ON DELETE cascade,
  CONSTRAINT "whatsapp_identity_contact_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "contact_id")
    REFERENCES "pg-drizzle_contact" ("clinic_id", "id") ON DELETE restrict,
  CONSTRAINT "whatsapp_identity_status"
    CHECK ("status" IN ('active', 'historical', 'conflict', 'unresolved'))
);
--> statement-breakpoint
CREATE INDEX "whatsapp_identity_clinic_contact_idx"
  ON "pg-drizzle_whatsapp_identity" USING btree ("clinic_id", "contact_id");
CREATE INDEX "whatsapp_identity_lookup_idx"
  ON "pg-drizzle_whatsapp_identity"
  USING btree ("clinic_id", "phone_number_id", "business_scoped_user_id", "phone_e164");
CREATE UNIQUE INDEX "whatsapp_identity_active_bsuid_unique"
  ON "pg-drizzle_whatsapp_identity"
  USING btree ("clinic_id", "phone_number_id", "business_scoped_user_id")
  WHERE "status" = 'active' AND "business_scoped_user_id" IS NOT NULL;
CREATE UNIQUE INDEX "whatsapp_identity_active_phone_unique"
  ON "pg-drizzle_whatsapp_identity"
  USING btree ("clinic_id", "phone_number_id", "phone_e164")
  WHERE "status" = 'active' AND "phone_e164" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_inbound_message" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" text NOT NULL,
  "event_name" text NOT NULL,
  "message_id" text NOT NULL,
  "batch_sequence" integer,
  "phone_number_id" text NOT NULL,
  "conversation_id" text,
  "customer_id" text,
  "direction" text NOT NULL,
  "origin" text NOT NULL,
  "type" text NOT NULL,
  "text" text,
  "from_wa_id" text,
  "phone_e164" text,
  "business_scoped_user_id" text,
  "parent_business_scoped_user_id" text,
  "username" text,
  "message_timestamp" timestamp with time zone,
  "raw_payload" jsonb NOT NULL,
  "clinic_id" uuid,
  "contact_id" uuid,
  "identity_id" uuid,
  "assistant_response_text" text,
  "status" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "lease_token" text,
  "lease_expires_at" timestamp with time zone,
  "next_attempt_at" timestamp with time zone,
  "last_error" text,
  "consent_reference" text,
  "service_window_expires_at" timestamp with time zone,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  CONSTRAINT "whatsapp_inbound_message_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "pg-drizzle_clinic" ("id") ON DELETE cascade,
  CONSTRAINT "whatsapp_inbound_message_contact_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "contact_id")
    REFERENCES "pg-drizzle_contact" ("clinic_id", "id") ON DELETE restrict,
  CONSTRAINT "whatsapp_inbound_message_identity_same_clinic_fk"
    FOREIGN KEY ("clinic_id", "identity_id")
    REFERENCES "pg-drizzle_whatsapp_identity" ("clinic_id", "id") ON DELETE restrict,
  CONSTRAINT "whatsapp_inbound_message_event_name"
    CHECK ("event_name" = 'whatsapp.message.received'),
  CONSTRAINT "whatsapp_inbound_message_status"
    CHECK ("status" IN ('awaiting-consent', 'conflict', 'ignored', 'pending', 'processed', 'processing', 'rejected')),
  CONSTRAINT "whatsapp_inbound_message_direction"
    CHECK ("direction" IN ('inbound', 'outbound', 'unknown')),
  CONSTRAINT "whatsapp_inbound_message_origin"
    CHECK ("origin" IN ('cloud_api', 'business_app', 'history_sync', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_inbound_message_idempotency_unique"
  ON "pg-drizzle_whatsapp_inbound_message" USING btree ("idempotency_key");
CREATE UNIQUE INDEX "whatsapp_inbound_message_message_unique"
  ON "pg-drizzle_whatsapp_inbound_message" USING btree ("phone_number_id", "message_id");
CREATE INDEX "whatsapp_inbound_message_claim_idx"
  ON "pg-drizzle_whatsapp_inbound_message"
  USING btree ("status", "next_attempt_at", "received_at", "batch_sequence");
CREATE INDEX "whatsapp_inbound_message_conversation_idx"
  ON "pg-drizzle_whatsapp_inbound_message"
  USING btree ("clinic_id", "conversation_id", "received_at");
CREATE INDEX "whatsapp_inbound_message_identity_idx"
  ON "pg-drizzle_whatsapp_inbound_message"
  USING btree ("clinic_id", "contact_id", "received_at");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_inbound_reply" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "recipient_business_scoped_user_id" text,
  "recipient_phone_e164" text,
  "button_label" text,
  "text" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "lease_token" text,
  "lease_expires_at" timestamp with time zone,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "provider_message_id" text,
  "last_error" text,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_inbound_reply_clinic_id_unique"
    UNIQUE ("clinic_id", "id"),
  CONSTRAINT "whatsapp_inbound_reply_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "pg-drizzle_clinic" ("id") ON DELETE cascade,
  CONSTRAINT "whatsapp_inbound_reply_recipient"
    CHECK (
      "recipient_business_scoped_user_id" IS NOT NULL
      OR "recipient_phone_e164" IS NOT NULL
    ),
  CONSTRAINT "whatsapp_inbound_reply_status"
    CHECK ("status" IN ('failed', 'pending', 'processing', 'sent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_inbound_reply_idempotency_unique"
  ON "pg-drizzle_whatsapp_inbound_reply"
  USING btree ("clinic_id", "idempotency_key");
CREATE INDEX "whatsapp_inbound_reply_ready_idx"
  ON "pg-drizzle_whatsapp_inbound_reply"
  USING btree ("status", "next_attempt_at");
--> statement-breakpoint
CREATE TABLE "pg-drizzle_whatsapp_conversation_lock" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "conversation_id" text NOT NULL,
  "owner_token" text NOT NULL,
  "lease_expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_conversation_lock_clinic_id_unique"
    UNIQUE ("clinic_id", "id"),
  CONSTRAINT "whatsapp_conversation_lock_clinic_fk"
    FOREIGN KEY ("clinic_id")
    REFERENCES "pg-drizzle_clinic" ("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_conversation_lock_key_unique"
  ON "pg-drizzle_whatsapp_conversation_lock"
  USING btree ("clinic_id", "conversation_id");
CREATE INDEX "whatsapp_conversation_lock_expiry_idx"
  ON "pg-drizzle_whatsapp_conversation_lock"
  USING btree ("lease_expires_at");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_identity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_identity" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_inbound_message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_inbound_message" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_inbound_reply" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_inbound_reply" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_conversation_lock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_whatsapp_conversation_lock" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "pg-drizzle_whatsapp_identity",
  "pg-drizzle_whatsapp_inbound_message",
  "pg-drizzle_whatsapp_inbound_reply",
  "pg-drizzle_whatsapp_conversation_lock"
TO panacea_clinical_access;
--> statement-breakpoint
CREATE POLICY "whatsapp_identity_worker_manage"
  ON "pg-drizzle_whatsapp_identity"
  FOR ALL
  USING (current_setting('app.whatsapp_inbound_worker', true) = 'true')
  WITH CHECK (current_setting('app.whatsapp_inbound_worker', true) = 'true');
CREATE POLICY "whatsapp_identity_clinic_owner_read"
  ON "pg-drizzle_whatsapp_identity"
  FOR SELECT
  USING (
    "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    AND current_setting('app.clinic_role', true) = 'owner'
  );
CREATE POLICY "whatsapp_identity_superadmin_read"
  ON "pg-drizzle_whatsapp_identity"
  FOR SELECT
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_identity_subscription_active_read"
  ON "pg-drizzle_whatsapp_identity"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_inbound_worker', true) = 'true'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
--> statement-breakpoint
CREATE POLICY "whatsapp_inbound_message_ingress_insert"
  ON "pg-drizzle_whatsapp_inbound_message"
  FOR INSERT
  WITH CHECK (current_setting('app.whatsapp_webhook_ingress', true) = 'true');
CREATE POLICY "whatsapp_inbound_message_ingress_ack"
  ON "pg-drizzle_whatsapp_inbound_message"
  FOR SELECT
  USING (current_setting('app.whatsapp_webhook_ingress', true) = 'true');
CREATE POLICY "whatsapp_inbound_message_worker_manage"
  ON "pg-drizzle_whatsapp_inbound_message"
  FOR ALL
  USING (current_setting('app.whatsapp_inbound_worker', true) = 'true')
  WITH CHECK (current_setting('app.whatsapp_inbound_worker', true) = 'true');
CREATE POLICY "whatsapp_inbound_message_superadmin_read"
  ON "pg-drizzle_whatsapp_inbound_message"
  FOR SELECT
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_inbound_reply_worker_manage"
  ON "pg-drizzle_whatsapp_inbound_reply"
  FOR ALL
  USING (
    current_setting('app.whatsapp_inbound_worker', true) = 'true'
    OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
  )
  WITH CHECK (
    current_setting('app.whatsapp_inbound_worker', true) = 'true'
    OR current_setting('app.whatsapp_outbound_worker', true) = 'true'
  );
CREATE POLICY "whatsapp_inbound_reply_superadmin_read"
  ON "pg-drizzle_whatsapp_inbound_reply"
  FOR SELECT
  USING (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
CREATE POLICY "whatsapp_conversation_lock_worker_manage"
  ON "pg-drizzle_whatsapp_conversation_lock"
  FOR ALL
  USING (current_setting('app.whatsapp_inbound_worker', true) = 'true')
  WITH CHECK (current_setting('app.whatsapp_inbound_worker', true) = 'true');
--> statement-breakpoint
DROP POLICY IF EXISTS "whatsapp_connection_subscription_active_read"
  ON "pg-drizzle_whatsapp_connection";
CREATE POLICY "whatsapp_connection_subscription_active_read"
  ON "pg-drizzle_whatsapp_connection"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.subscription_status', true) = 'active'
    OR current_setting('app.whatsapp_inbound', true) = 'true'
    OR current_setting('app.whatsapp_provisioning_worker', true) = 'true'
    OR current_setting('app.whatsapp_inbound_worker', true) = 'true'
    OR NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL
  );
CREATE POLICY "whatsapp_connection_inbound_worker_read"
  ON "pg-drizzle_whatsapp_connection"
  FOR SELECT
  USING (current_setting('app.whatsapp_inbound_worker', true) = 'true');
