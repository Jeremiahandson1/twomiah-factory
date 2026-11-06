CREATE TABLE IF NOT EXISTS "roof_job_status" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"milestone" text NOT NULL,
	"name" text NOT NULL,
	"job_types" json DEFAULT '[]'::json NOT NULL,
	"checklist" json DEFAULT '[]'::json NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "roof_status_id" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "roof_status_checks" json;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roof_job_status" ADD CONSTRAINT "roof_job_status_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roof_job_status_company_id_idx" ON "roof_job_status" USING btree ("company_id");