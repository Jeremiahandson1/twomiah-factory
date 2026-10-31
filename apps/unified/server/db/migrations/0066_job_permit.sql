CREATE TABLE IF NOT EXISTS "job_permit" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"permit_type" text,
	"jurisdiction" text,
	"permit_number" text,
	"status" text DEFAULT 'needed' NOT NULL,
	"fee_cents" integer,
	"fee_paid_on" timestamp,
	"applied_on" timestamp,
	"issued_on" timestamp,
	"expires_on" timestamp,
	"finaled_on" timestamp,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_permit" ADD CONSTRAINT "job_permit_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_permit" ADD CONSTRAINT "job_permit_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_permit" ADD CONSTRAINT "job_permit_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_permit_company_id_idx" ON "job_permit" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_permit_job_id_idx" ON "job_permit" USING btree ("job_id");