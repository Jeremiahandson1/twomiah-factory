ALTER TABLE "lead" ADD COLUMN "assigned_to_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead" ADD CONSTRAINT "lead_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_assigned_to_idx" ON "lead" USING btree ("assigned_to_id");