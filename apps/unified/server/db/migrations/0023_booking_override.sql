ALTER TABLE "booking" ADD COLUMN "override_by_user_id" text;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "override_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking" ADD CONSTRAINT "booking_override_by_user_id_user_id_fk" FOREIGN KEY ("override_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
