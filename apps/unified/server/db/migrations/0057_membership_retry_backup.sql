ALTER TABLE "membership_charge" ADD COLUMN "backup_tried" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_charge" ADD COLUMN "retried_by_user_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_charge" ADD CONSTRAINT "membership_charge_retried_by_user_id_user_id_fk" FOREIGN KEY ("retried_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
