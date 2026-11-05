CREATE TABLE IF NOT EXISTS "alert_rule_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "autopay_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"client_id" text NOT NULL,
	"charge_on" date NOT NULL,
	"amount_cents" integer,
	"label" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE IF NOT EXISTS "client_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"credential_type" text NOT NULL,
	"issuing_body" text,
	"issue_date" date,
	"expiry_date" date,
	"document_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_credential_reminder" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_credential_id" text NOT NULL,
	"stage" text NOT NULL,
	"expiry_date" date NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_field_value" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"entity" text NOT NULL,
	"record_id" text NOT NULL,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE IF NOT EXISTS "family_alert_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"minutes" integer,
	"audience" text NOT NULL,
	"channels" json NOT NULL,
	"message" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "family_push_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"family_member_id" text NOT NULL,
	"subscription" json NOT NULL,
	"endpoint" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "family_request" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"family_member_id" text NOT NULL,
	"kind" text NOT NULL,
	"visit_date" text,
	"details" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"task_id" text,
	"handled_by_id" text,
	"handled_note" text,
	"handled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_external_id" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"entity" text NOT NULL,
	"external_id" text NOT NULL,
	"record_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"headers" json NOT NULL,
	"mapping" json NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
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
CREATE TABLE IF NOT EXISTS "migration_file" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"request_id" text NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"data" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "migration_request" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"from_system" text,
	"note" text,
	"old_counts" json,
	"signoffs" json DEFAULT '{}'::json NOT NULL,
	"batch_ids" json DEFAULT '[]'::json NOT NULL,
	"staff_note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "open_shift_message" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"open_shift_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"channel" text NOT NULL,
	"target" text,
	"status" text NOT NULL,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "open_shift_pickup" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"open_shift_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"client_id" text,
	"shift_date" date NOT NULL,
	"bonus_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "open_shift_response" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"open_shift_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"response" text NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pay_hour_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"review_id" text,
	"segment_kind" text NOT NULL,
	"segment_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"regular_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"double_time_minutes" integer DEFAULT 0 NOT NULL,
	"unpaid_minutes" integer DEFAULT 0 NOT NULL,
	"is_holiday" boolean DEFAULT false NOT NULL,
	"rate_cents" integer DEFAULT 0 NOT NULL,
	"rule_id" text NOT NULL,
	"reasons" json DEFAULT '[]'::json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_push" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"provider" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text NOT NULL,
	"people" integer DEFAULT 0 NOT NULL,
	"request" json,
	"response" json,
	"error" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE IF NOT EXISTS "reward_item" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"cost_points" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reward_point" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"kind" text NOT NULL,
	"points" integer NOT NULL,
	"reference" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reward_redemption" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"reward_item_id" text,
	"name" text NOT NULL,
	"points" integer NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"handled_by_id" text,
	"handled_note" text,
	"handled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_answer" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"question_id" text NOT NULL,
	"prompt" text NOT NULL,
	"phase" text NOT NULL,
	"answer" text NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"answered_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_item" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"detail" text,
	"goal_id" text,
	"form_template_id" text,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_item_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"item_id" text NOT NULL,
	"status" text NOT NULL,
	"rating" text,
	"note" text,
	"form_submission_id" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_meal" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"client_id" text NOT NULL,
	"meal" text NOT NULL,
	"description" text,
	"amount_eaten" text NOT NULL,
	"note" text,
	"recorded_by_id" text,
	"served_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_question" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"prompt" text NOT NULL,
	"kind" text NOT NULL,
	"options" json,
	"phase" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"flag_on" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_signature" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"client_id" text NOT NULL,
	"signature_image" text,
	"signed_at" timestamp,
	"reason_code" text,
	"reason_note" text,
	"recorded_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "family_visit_text_key";--> statement-breakpoint
ALTER TABLE "autopay_attempt" ADD COLUMN "schedule_id" text;--> statement-breakpoint
ALTER TABLE "autopay_attempt" ADD COLUMN "reminders_sent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "autopay_attempt" ADD COLUMN "last_reminder_at" timestamp;--> statement-breakpoint
ALTER TABLE "autopay_attempt" ADD COLUMN "receipt_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "care_types" ADD COLUMN "exclude_from_overtime" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "caregiver_availability" ADD COLUMN "hours_wanted" integer;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "mileage_rate" numeric(5, 3);--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "is_facility_staff" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "team" text;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "manager_user_id" text;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "left_on" date;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "left_reason" text;--> statement-breakpoint
ALTER TABLE "client_autopay" ADD COLUMN "method" text DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_autopay" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "client_autopay" ADD COLUMN "mandate_id" text;--> statement-breakpoint
ALTER TABLE "client_autopay" ADD COLUMN "saved_by" text;--> statement-breakpoint
ALTER TABLE "client_autopay" ADD COLUMN "expiry_warned_for" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "share_with_family" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "can_view_vitals" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "can_view_documents" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "can_manage_payments" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "visit_text_consent_wording" text;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "visit_text_optout_at" timestamp;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "visit_email_optin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "visit_email_optin_at" timestamp;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "visit_email_consent_wording" text;--> statement-breakpoint
ALTER TABLE "family_visit_text" ADD COLUMN "channel" text DEFAULT 'sms' NOT NULL;--> statement-breakpoint
ALTER TABLE "family_visit_text" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "family_visit_text" ADD COLUMN "rule_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "updated" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "attached" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "source" text DEFAULT 'office' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "options" json;--> statement-breakpoint
ALTER TABLE "import_batch_record" ADD COLUMN "table_name" text;--> statement-breakpoint
ALTER TABLE "import_batch_record" ADD COLUMN "action" text DEFAULT 'created' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch_record" ADD COLUMN "previous" json;--> statement-breakpoint
ALTER TABLE "import_batch_record" ADD COLUMN "extra" json;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "dose_times" json;--> statement-breakpoint
ALTER TABLE "mileage_entries" ADD COLUMN "kind" text DEFAULT 'travel' NOT NULL;--> statement-breakpoint
ALTER TABLE "mileage_entries" ADD COLUMN "source" text DEFAULT 'entered' NOT NULL;--> statement-breakpoint
ALTER TABLE "mileage_entries" ADD COLUMN "review_id" text;--> statement-breakpoint
ALTER TABLE "open_shifts" ADD COLUMN "respond_by" timestamp;--> statement-breakpoint
ALTER TABLE "open_shifts" ADD COLUMN "series_id" text;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD COLUMN "bonus_pay" numeric(10, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "payroll_shift_reviews" ADD COLUMN "travel_paid" boolean;--> statement-breakpoint
ALTER TABLE "payroll_shift_reviews" ADD COLUMN "travel_minutes" integer;--> statement-breakpoint
ALTER TABLE "payroll_shift_reviews" ADD COLUMN "travel_miles" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "payroll_shift_reviews" ADD COLUMN "meal_break_minutes" integer;--> statement-breakpoint
ALTER TABLE "payroll_shift_reviews" ADD COLUMN "meal_waived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_shift_reviews" ADD COLUMN "rest_break_missed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_shift_reviews" ADD COLUMN "is_sleepover" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "repeat_group_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_rule_log" ADD CONSTRAINT "alert_rule_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_rule_log" ADD CONSTRAINT "alert_rule_log_rule_id_family_alert_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."family_alert_rule"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_rule_log" ADD CONSTRAINT "alert_rule_log_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "autopay_schedule" ADD CONSTRAINT "autopay_schedule_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "autopay_schedule" ADD CONSTRAINT "autopay_schedule_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "autopay_schedule" ADD CONSTRAINT "autopay_schedule_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
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
 ALTER TABLE "client_credential" ADD CONSTRAINT "client_credential_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_credential" ADD CONSTRAINT "client_credential_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_credential_reminder" ADD CONSTRAINT "client_credential_reminder_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_credential_reminder" ADD CONSTRAINT "client_credential_reminder_client_credential_id_client_credential_id_fk" FOREIGN KEY ("client_credential_id") REFERENCES "public"."client_credential"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
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
 ALTER TABLE "family_alert_rule" ADD CONSTRAINT "family_alert_rule_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_alert_rule" ADD CONSTRAINT "family_alert_rule_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_push_subscription" ADD CONSTRAINT "family_push_subscription_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_push_subscription" ADD CONSTRAINT "family_push_subscription_family_member_id_family_members_id_fk" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_request" ADD CONSTRAINT "family_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_request" ADD CONSTRAINT "family_request_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_request" ADD CONSTRAINT "family_request_family_member_id_family_members_id_fk" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_request" ADD CONSTRAINT "family_request_handled_by_id_user_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_external_id" ADD CONSTRAINT "import_external_id_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_mapping" ADD CONSTRAINT "import_mapping_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
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
DO $$ BEGIN
 ALTER TABLE "migration_file" ADD CONSTRAINT "migration_file_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "migration_file" ADD CONSTRAINT "migration_file_request_id_migration_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."migration_request"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "migration_request" ADD CONSTRAINT "migration_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_message" ADD CONSTRAINT "open_shift_message_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_message" ADD CONSTRAINT "open_shift_message_open_shift_id_open_shifts_id_fk" FOREIGN KEY ("open_shift_id") REFERENCES "public"."open_shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_message" ADD CONSTRAINT "open_shift_message_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_pickup" ADD CONSTRAINT "open_shift_pickup_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_pickup" ADD CONSTRAINT "open_shift_pickup_open_shift_id_open_shifts_id_fk" FOREIGN KEY ("open_shift_id") REFERENCES "public"."open_shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_pickup" ADD CONSTRAINT "open_shift_pickup_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_response" ADD CONSTRAINT "open_shift_response_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_response" ADD CONSTRAINT "open_shift_response_open_shift_id_open_shifts_id_fk" FOREIGN KEY ("open_shift_id") REFERENCES "public"."open_shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_response" ADD CONSTRAINT "open_shift_response_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pay_hour_audit" ADD CONSTRAINT "pay_hour_audit_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pay_hour_audit" ADD CONSTRAINT "pay_hour_audit_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_push" ADD CONSTRAINT "payroll_push_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_push" ADD CONSTRAINT "payroll_push_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
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
DO $$ BEGIN
 ALTER TABLE "reward_item" ADD CONSTRAINT "reward_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_point" ADD CONSTRAINT "reward_point_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_point" ADD CONSTRAINT "reward_point_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_redemption" ADD CONSTRAINT "reward_redemption_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_redemption" ADD CONSTRAINT "reward_redemption_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_redemption" ADD CONSTRAINT "reward_redemption_reward_item_id_reward_item_id_fk" FOREIGN KEY ("reward_item_id") REFERENCES "public"."reward_item"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_redemption" ADD CONSTRAINT "reward_redemption_handled_by_id_user_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_answer" ADD CONSTRAINT "visit_answer_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_answer" ADD CONSTRAINT "visit_answer_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_answer" ADD CONSTRAINT "visit_answer_answered_by_id_user_id_fk" FOREIGN KEY ("answered_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_item" ADD CONSTRAINT "visit_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_item" ADD CONSTRAINT "visit_item_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_item" ADD CONSTRAINT "visit_item_form_template_id_form_templates_id_fk" FOREIGN KEY ("form_template_id") REFERENCES "public"."form_templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_item_log" ADD CONSTRAINT "visit_item_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_item_log" ADD CONSTRAINT "visit_item_log_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_item_log" ADD CONSTRAINT "visit_item_log_item_id_visit_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."visit_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_item_log" ADD CONSTRAINT "visit_item_log_form_submission_id_form_submissions_id_fk" FOREIGN KEY ("form_submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_meal" ADD CONSTRAINT "visit_meal_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_meal" ADD CONSTRAINT "visit_meal_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_meal" ADD CONSTRAINT "visit_meal_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_meal" ADD CONSTRAINT "visit_meal_recorded_by_id_user_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_question" ADD CONSTRAINT "visit_question_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_signature" ADD CONSTRAINT "visit_signature_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_signature" ADD CONSTRAINT "visit_signature_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_signature" ADD CONSTRAINT "visit_signature_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_signature" ADD CONSTRAINT "visit_signature_recorded_by_id_user_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_rule_log_company_idx" ON "alert_rule_log" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alert_rule_log_key" ON "alert_rule_log" USING btree ("rule_id","time_entry_id","recipient_id","channel");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "autopay_schedule_due_idx" ON "autopay_schedule" USING btree ("company_id","status","charge_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "autopay_schedule_invoice_idx" ON "autopay_schedule" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "caregiver_risk_snapshot_day_idx" ON "caregiver_risk_snapshot" USING btree ("caregiver_id","as_of");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_risk_snapshot_company_idx" ON "caregiver_risk_snapshot" USING btree ("company_id","as_of");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_survey_company_idx" ON "caregiver_survey" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "caregiver_survey_request_once_idx" ON "caregiver_survey_request" USING btree ("survey_id","caregiver_id","point_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_survey_request_caregiver_idx" ON "caregiver_survey_request" USING btree ("caregiver_id","answered_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_survey_request_company_idx" ON "caregiver_survey_request" USING btree ("company_id","due_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_credential_company_idx" ON "client_credential" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_credential_client_idx" ON "client_credential" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_credential_reminder_key" ON "client_credential_reminder" USING btree ("client_credential_id","expiry_date","stage");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_value_key" ON "custom_field_value" USING btree ("company_id","entity","record_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_layout_company_idx" ON "dashboard_layout" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_alert_rule_company_idx" ON "family_alert_rule" USING btree ("company_id","trigger");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_push_subscription_member_idx" ON "family_push_subscription" USING btree ("family_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "family_push_subscription_endpoint_idx" ON "family_push_subscription" USING btree ("company_id","endpoint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_request_company_idx" ON "family_request" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_request_client_idx" ON "family_request" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_external_id_key" ON "import_external_id" USING btree ("company_id","entity","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_external_id_record_idx" ON "import_external_id" USING btree ("company_id","entity","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_mapping_company_kind_name" ON "import_mapping" USING btree ("company_id","kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "medication_dose_reminder_once_idx" ON "medication_dose_reminder" USING btree ("medication_id","time_entry_id","due_at","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medication_dose_reminder_company_idx" ON "medication_dose_reminder" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "migration_file_request_idx" ON "migration_file" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "migration_request_company_idx" ON "migration_request" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shift_message_shift_idx" ON "open_shift_message" USING btree ("open_shift_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shift_message_company_idx" ON "open_shift_message" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "open_shift_pickup_shift_idx" ON "open_shift_pickup" USING btree ("open_shift_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shift_pickup_caregiver_idx" ON "open_shift_pickup" USING btree ("company_id","caregiver_id","shift_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "open_shift_response_shift_caregiver_idx" ON "open_shift_response" USING btree ("open_shift_id","caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shift_response_company_idx" ON "open_shift_response" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pay_hour_audit_company_id_idx" ON "pay_hour_audit" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pay_hour_audit_caregiver_period_idx" ON "pay_hour_audit" USING btree ("caregiver_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_push_company_id_idx" ON "payroll_push" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_definition_company_idx" ON "report_definition" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_delivery_company_idx" ON "report_delivery" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedule_company_idx" ON "report_schedule" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedule_due_idx" ON "report_schedule" USING btree ("next_run_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_item_company_idx" ON "reward_item" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reward_point_ref_idx" ON "reward_point" USING btree ("company_id","caregiver_id","kind","reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_point_caregiver_idx" ON "reward_point" USING btree ("company_id","caregiver_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_redemption_company_idx" ON "reward_redemption" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_redemption_caregiver_idx" ON "reward_redemption" USING btree ("caregiver_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_answer_once_idx" ON "visit_answer" USING btree ("time_entry_id","question_id","phase");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_answer_company_idx" ON "visit_answer" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_item_company_client_idx" ON "visit_item" USING btree ("company_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_item_log_once_idx" ON "visit_item_log" USING btree ("time_entry_id","item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_item_log_company_idx" ON "visit_item_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_meal_visit_idx" ON "visit_meal" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_meal_client_idx" ON "visit_meal" USING btree ("client_id","served_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_meal_once_idx" ON "visit_meal" USING btree ("time_entry_id","meal");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_question_company_idx" ON "visit_question" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_signature_visit_idx" ON "visit_signature" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_signature_company_idx" ON "visit_signature" USING btree ("company_id","created_at");--> statement-breakpoint
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
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mileage_entries" ADD CONSTRAINT "mileage_entries_review_id_payroll_shift_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."payroll_shift_reviews"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mileage_entries_review_idx" ON "mileage_entries" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shifts_series_idx" ON "open_shifts" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedules_repeat_group_idx" ON "schedules" USING btree ("repeat_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "family_visit_text_key" ON "family_visit_text" USING btree ("time_entry_id","family_member_id","event","channel","rule_id");--> statement-breakpoint
-- Vitals followed the medicines switch until now: keep every relative seeing exactly what they saw, so turning the new switch on changes nothing by itself.
UPDATE "family_members" SET "can_view_vitals" = "can_view_medications";
