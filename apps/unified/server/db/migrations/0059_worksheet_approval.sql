CREATE TABLE IF NOT EXISTS "job_worksheet_approval" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"approved_by_id" text,
	"approved_at" timestamp DEFAULT now() NOT NULL,
	"revenue" numeric(12, 2) NOT NULL,
	"cost" numeric(12, 2) NOT NULL,
	"profit" numeric(12, 2) NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "roof_money_setting" ADD COLUMN "require_worksheet_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_worksheet_approval" ADD CONSTRAINT "job_worksheet_approval_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_worksheet_approval" ADD CONSTRAINT "job_worksheet_approval_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_worksheet_approval" ADD CONSTRAINT "job_worksheet_approval_approved_by_id_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_worksheet_approval_job_id_idx" ON "job_worksheet_approval" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_worksheet_approval_company_id_idx" ON "job_worksheet_approval" USING btree ("company_id");