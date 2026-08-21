-- Online bookings in a salon land in the appointment book, not the contractor
-- jobs pipeline. job_id stays for schema compatibility but is no longer written.
ALTER TABLE "online_booking" ADD COLUMN IF NOT EXISTS "appointment_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "online_booking" ADD CONSTRAINT "online_booking_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
