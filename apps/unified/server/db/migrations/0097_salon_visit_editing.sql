ALTER TABLE "appointment_item" ADD COLUMN "requested_stylist" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_record" ADD COLUMN "appointment_item_id" text;