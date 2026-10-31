CREATE TABLE IF NOT EXISTS "caregiver_risk_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"as_of" date NOT NULL,
	"score" integer NOT NULL,
	"band" text NOT NULL,
	"reasons" json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caregiver_survey" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"days" integer,
	"questions" json NOT NULL,
	"alert_below" integer DEFAULT 3 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caregiver_survey_request" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"survey_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"client_id" text,
	"point_key" text NOT NULL,
	"reason" text NOT NULL,
	"due_on" date NOT NULL,
	"sent_at" timestamp,
	"pushed" boolean DEFAULT false NOT NULL,
	"answered_at" timestamp,
	"answers" json,
	"score" integer,
	"comment" text,
	"alerted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboard_layout" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"tiles" json NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_definition" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source" text DEFAULT 'visits' NOT NULL,
	"columns" json NOT NULL,
	"filters" json DEFAULT '[]'::json NOT NULL,
	"sort_by" text,
	"sort_dir" text DEFAULT 'asc',
	"group_by" text,
	"copied_from_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"schedule_id" text,
	"name" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"ciphertext" text NOT NULL,
	"byte_size" integer NOT NULL,
	"period_start" date,
	"period_end" date,
	"recipients" json NOT NULL,
	"sent_to" json DEFAULT '[]'::json NOT NULL,
	"expires_at" timestamp NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"report_kind" text NOT NULL,
	"report_id" text,
	"format" text DEFAULT 'csv' NOT NULL,
	"cadence" text NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"hour" integer DEFAULT 6 NOT NULL,
	"window_days" integer DEFAULT 7 NOT NULL,
	"recipients" json NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_on" date,
	"next_run_on" date,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "team" text;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "manager_user_id" text;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "left_on" date;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "left_reason" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "branch_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_risk_snapshot" ADD CONSTRAINT "caregiver_risk_snapshot_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_risk_snapshot" ADD CONSTRAINT "caregiver_risk_snapshot_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_survey" ADD CONSTRAINT "caregiver_survey_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_survey" ADD CONSTRAINT "caregiver_survey_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_survey_request" ADD CONSTRAINT "caregiver_survey_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_survey_request" ADD CONSTRAINT "caregiver_survey_request_survey_id_caregiver_survey_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."caregiver_survey"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_survey_request" ADD CONSTRAINT "caregiver_survey_request_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_survey_request" ADD CONSTRAINT "caregiver_survey_request_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboard_layout" ADD CONSTRAINT "dashboard_layout_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboard_layout" ADD CONSTRAINT "dashboard_layout_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_definition" ADD CONSTRAINT "report_definition_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_definition" ADD CONSTRAINT "report_definition_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_delivery" ADD CONSTRAINT "report_delivery_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_delivery" ADD CONSTRAINT "report_delivery_schedule_id_report_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedule"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_schedule" ADD CONSTRAINT "report_schedule_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_schedule" ADD CONSTRAINT "report_schedule_report_id_report_definition_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report_definition"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_schedule" ADD CONSTRAINT "report_schedule_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "caregiver_risk_snapshot_day_idx" ON "caregiver_risk_snapshot" USING btree ("caregiver_id","as_of");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_risk_snapshot_company_idx" ON "caregiver_risk_snapshot" USING btree ("company_id","as_of");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_survey_company_idx" ON "caregiver_survey" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "caregiver_survey_request_once_idx" ON "caregiver_survey_request" USING btree ("survey_id","caregiver_id","point_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_survey_request_caregiver_idx" ON "caregiver_survey_request" USING btree ("caregiver_id","answered_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_survey_request_company_idx" ON "caregiver_survey_request" USING btree ("company_id","due_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_layout_company_idx" ON "dashboard_layout" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_definition_company_idx" ON "report_definition" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_delivery_company_idx" ON "report_delivery" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedule_company_idx" ON "report_schedule" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedule_due_idx" ON "report_schedule" USING btree ("next_run_on");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_profiles" ADD CONSTRAINT "caregiver_profiles_branch_id_service_locations_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."service_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_profiles" ADD CONSTRAINT "caregiver_profiles_manager_user_id_user_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_branch_id_service_locations_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."service_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
