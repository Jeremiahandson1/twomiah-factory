CREATE TABLE IF NOT EXISTS "visit_report" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"contact_id" text,
	"note" text,
	"skip" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"channel" text,
	"photo_count" integer DEFAULT 0 NOT NULL,
	"send_at" timestamp,
	"sent_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_report" ADD CONSTRAINT "visit_report_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_report" ADD CONSTRAINT "visit_report_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_report" ADD CONSTRAINT "visit_report_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_report_job_idx" ON "visit_report" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_report_company_id_idx" ON "visit_report" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_report_contact_id_idx" ON "visit_report" USING btree ("contact_id");