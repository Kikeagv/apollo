ALTER TABLE "pg-drizzle_service_offer"
  DROP CONSTRAINT "service_offer_doctor_same_clinic_fk";
--> statement-breakpoint
ALTER TABLE "pg-drizzle_service_offer"
  ADD CONSTRAINT "service_offer_doctor_same_clinic_fk"
  FOREIGN KEY ("clinic_id", "doctor_id")
  REFERENCES "public"."pg-drizzle_doctor"("clinic_id", "id") ON DELETE cascade;
