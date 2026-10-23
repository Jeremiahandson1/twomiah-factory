CREATE TABLE IF NOT EXISTS "job_series" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"frequency" text NOT NULL,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"first_date" text NOT NULL,
	"occurrences_count" integer,
	"until_date" text,
	"status" text DEFAULT 'active' NOT NULL,
	"stopped_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "series_id" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "series_index" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_series" ADD CONSTRAINT "job_series_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_series" ADD CONSTRAINT "job_series_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_series_company_id_idx" ON "job_series" USING btree ("company_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_series_id_job_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."job_series"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_series_id_idx" ON "job" USING btree ("series_id");