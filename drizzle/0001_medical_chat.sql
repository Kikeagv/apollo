CREATE TABLE "pg-drizzle_superadmin" (
	"identity_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pg-drizzle_superadmin" ADD CONSTRAINT "pg-drizzle_superadmin_identity_id_user_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;