CREATE TABLE IF NOT EXISTS "certification_reminder" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"certification_record_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"stage" text NOT NULL,
	"expiry_date" date NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certification_reminder" ADD CONSTRAINT "certification_reminder_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certification_reminder" ADD CONSTRAINT "certification_reminder_certification_record_id_certification_records_id_fk" FOREIGN KEY ("certification_record_id") REFERENCES "public"."certification_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certification_reminder" ADD CONSTRAINT "certification_reminder_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certification_reminder_company_id_idx" ON "certification_reminder" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "certification_reminder_key" ON "certification_reminder" USING btree ("certification_record_id","expiry_date","stage");