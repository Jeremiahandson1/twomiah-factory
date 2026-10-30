CREATE TABLE IF NOT EXISTS "inspection_report" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"title" text NOT NULL,
	"intro" text,
	"sections" json DEFAULT '[]'::json NOT NULL,
	"public_token" text,
	"link_expires_at" timestamp,
	"shared_with_customer" boolean DEFAULT false NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_report_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
ALTER TABLE "job_photo" ADD COLUMN "latitude" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "job_photo" ADD COLUMN "longitude" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "job_photo" ADD COLUMN "shared_with_customer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_report" ADD CONSTRAINT "inspection_report_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_report" ADD CONSTRAINT "inspection_report_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_report" ADD CONSTRAINT "inspection_report_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_report_company_id_idx" ON "inspection_report" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_report_job_id_idx" ON "inspection_report" USING btree ("job_id");