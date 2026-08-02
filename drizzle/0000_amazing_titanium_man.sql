CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_clinic_invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "pg-drizzle_clinic_invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_clinic_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"identity_id" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_clinic" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_synthetic" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_identity_audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid,
	"actor_identity_id" text,
	"action" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_patient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_invitation" ADD CONSTRAINT "pg-drizzle_clinic_invitation_clinic_id_pg-drizzle_clinic_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."pg-drizzle_clinic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_user" ADD CONSTRAINT "pg-drizzle_clinic_user_clinic_id_pg-drizzle_clinic_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."pg-drizzle_clinic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic_user" ADD CONSTRAINT "pg-drizzle_clinic_user_identity_id_user_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_identity_audit_event" ADD CONSTRAINT "pg-drizzle_identity_audit_event_clinic_id_pg-drizzle_clinic_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."pg-drizzle_clinic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_identity_audit_event" ADD CONSTRAINT "pg-drizzle_identity_audit_event_actor_identity_id_user_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_patient" ADD CONSTRAINT "pg-drizzle_patient_clinic_id_pg-drizzle_clinic_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."pg-drizzle_clinic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinic_user_identity_idx" ON "pg-drizzle_clinic_user" USING btree ("identity_id");
--> statement-breakpoint
ALTER TABLE "pg-drizzle_clinic" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_clinic" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_clinic_user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_clinic_user" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_clinic_invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_clinic_invitation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_patient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_patient" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_identity_audit_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg-drizzle_identity_audit_event" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "clinic_isolation" ON "pg-drizzle_clinic"
  USING (id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "superadmin_creates_clinic" ON "pg-drizzle_clinic" FOR INSERT
  WITH CHECK (NULLIF(current_setting('app.superadmin_id', true), '') IS NOT NULL);
--> statement-breakpoint
CREATE POLICY "clinic_membership_isolation" ON "pg-drizzle_clinic_user"
  USING (
    identity_id = NULLIF(current_setting('app.identity_id', true), '')
    OR clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  )
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "clinic_invitation_isolation" ON "pg-drizzle_clinic_invitation"
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "patient_clinic_isolation" ON "pg-drizzle_patient"
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "identity_audit_clinic_isolation" ON "pg-drizzle_identity_audit_event"
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
