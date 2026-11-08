ALTER TABLE "contact" ADD COLUMN "created_by_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "created_by_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact" ADD CONSTRAINT "contact_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project" ADD CONSTRAINT "project_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
