ALTER TABLE "email_alias" ADD COLUMN "user_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_alias" ADD CONSTRAINT "email_alias_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
