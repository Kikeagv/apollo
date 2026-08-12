ALTER TABLE "pg-drizzle_appointment_event"
  ADD CONSTRAINT "appointment_event_exactly_one_actor"
  CHECK (num_nonnulls("actor_clinic_user_id", "actor_contact_id") = 1);
