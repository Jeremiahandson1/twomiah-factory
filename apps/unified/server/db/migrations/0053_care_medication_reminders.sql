CREATE TABLE IF NOT EXISTS "medication_dose_reminder" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"medication_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"due_at" timestamp NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "dose_times" json;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medication_dose_reminder" ADD CONSTRAINT "medication_dose_reminder_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medication_dose_reminder" ADD CONSTRAINT "medication_dose_reminder_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medication_dose_reminder" ADD CONSTRAINT "medication_dose_reminder_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "medication_dose_reminder_once_idx" ON "medication_dose_reminder" USING btree ("medication_id","time_entry_id","due_at","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medication_dose_reminder_company_idx" ON "medication_dose_reminder" USING btree ("company_id");