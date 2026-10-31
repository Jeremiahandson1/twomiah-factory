CREATE TABLE IF NOT EXISTS "landscaping_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"rain_day_skip_sundays" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "route_billing_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"from_date" text NOT NULL,
	"to_date" text NOT NULL,
	"group_by" text DEFAULT 'none' NOT NULL,
	"invoice_count" integer DEFAULT 0 NOT NULL,
	"visit_count" integer DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"undone_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "route_visit_invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"invoice_line_item_id" text,
	"batch_id" text,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_shape" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"site_id" text NOT NULL,
	"area_type" text NOT NULL,
	"mode" text DEFAULT 'add' NOT NULL,
	"label" text,
	"path" json NOT NULL,
	"area_sqft" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snow_storm" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snow_storm_stop" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"storm_id" text NOT NULL,
	"snow_contract_id" text NOT NULL,
	"site_id" text NOT NULL,
	"job_id" text,
	"event_id" text,
	"assigned_to_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"started_at" timestamp,
	"done_at" timestamp,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "job" ADD COLUMN "started_at" timestamp;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "recurring_route_stop_id" text;--> statement-breakpoint
ALTER TABLE "job_series" ADD COLUMN "weekdays" text;--> statement-breakpoint
ALTER TABLE "recurring_route" ADD COLUMN "start_time" text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_route" ADD COLUMN "billing_mode" text;--> statement-breakpoint
ALTER TABLE "snow_contract" ADD COLUMN "hourly_rate" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "snow_event" ADD COLUMN "hours" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "snow_event" ADD COLUMN "storm_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "landscaping_setting" ADD CONSTRAINT "landscaping_setting_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_billing_batch" ADD CONSTRAINT "route_billing_batch_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_billing_batch" ADD CONSTRAINT "route_billing_batch_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_visit_invoice" ADD CONSTRAINT "route_visit_invoice_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_visit_invoice" ADD CONSTRAINT "route_visit_invoice_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_visit_invoice" ADD CONSTRAINT "route_visit_invoice_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_visit_invoice" ADD CONSTRAINT "route_visit_invoice_invoice_line_item_id_invoice_line_item_id_fk" FOREIGN KEY ("invoice_line_item_id") REFERENCES "public"."invoice_line_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_visit_invoice" ADD CONSTRAINT "route_visit_invoice_batch_id_route_billing_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."route_billing_batch"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_shape" ADD CONSTRAINT "site_shape_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_shape" ADD CONSTRAINT "site_shape_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm" ADD CONSTRAINT "snow_storm_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm" ADD CONSTRAINT "snow_storm_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm_stop" ADD CONSTRAINT "snow_storm_stop_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm_stop" ADD CONSTRAINT "snow_storm_stop_storm_id_snow_storm_id_fk" FOREIGN KEY ("storm_id") REFERENCES "public"."snow_storm"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm_stop" ADD CONSTRAINT "snow_storm_stop_snow_contract_id_snow_contract_id_fk" FOREIGN KEY ("snow_contract_id") REFERENCES "public"."snow_contract"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm_stop" ADD CONSTRAINT "snow_storm_stop_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm_stop" ADD CONSTRAINT "snow_storm_stop_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm_stop" ADD CONSTRAINT "snow_storm_stop_event_id_snow_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."snow_event"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm_stop" ADD CONSTRAINT "snow_storm_stop_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
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
CREATE UNIQUE INDEX IF NOT EXISTS "landscaping_setting_company_id_idx" ON "landscaping_setting" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_billing_batch_company_id_idx" ON "route_billing_batch" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "route_visit_invoice_job_idx" ON "route_visit_invoice" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_visit_invoice_invoice_id_idx" ON "route_visit_invoice" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_visit_invoice_company_id_idx" ON "route_visit_invoice" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_shape_site_id_idx" ON "site_shape" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_shape_company_id_idx" ON "site_shape" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snow_storm_company_id_idx" ON "snow_storm" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "snow_storm_stop_contract_idx" ON "snow_storm_stop" USING btree ("storm_id","snow_contract_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snow_storm_stop_company_id_idx" ON "snow_storm_stop" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snow_storm_stop_job_id_idx" ON "snow_storm_stop" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_report_job_idx" ON "visit_report" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_report_company_id_idx" ON "visit_report" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_report_contact_id_idx" ON "visit_report" USING btree ("contact_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_event" ADD CONSTRAINT "snow_event_storm_id_snow_storm_id_fk" FOREIGN KEY ("storm_id") REFERENCES "public"."snow_storm"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_route_stop_day_idx" ON "job" USING btree ("recurring_route_stop_id","scheduled_date") WHERE recurring_route_stop_id IS NOT NULL;