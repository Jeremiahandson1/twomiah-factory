CREATE TABLE IF NOT EXISTS "autopay_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"client_id" text NOT NULL,
	"attempt_no" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_cents" integer NOT NULL,
	"payment_intent_id" text,
	"failure_code" text,
	"failure_message" text,
	"hard_decline" boolean DEFAULT false NOT NULL,
	"next_attempt_at" timestamp,
	"notified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certification_reminder" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"certification_record_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"stage" text NOT NULL,
	"expiry_date" date NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_autopay" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paused_reason" text,
	"stripe_account" text,
	"stripe_customer_id" text,
	"payment_method_id" text,
	"brand" text,
	"last4" text,
	"exp_month" integer,
	"exp_year" integer,
	"setup_session_id" text,
	"consent_text" text,
	"consent_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_ltc_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"insured_name" text,
	"policy_number" text,
	"claim_number" text,
	"daily_max" numeric(10, 2),
	"notes" text,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "family_visit_text" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"family_member_id" text NOT NULL,
	"event" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"file_name" text,
	"status" text DEFAULT 'done' NOT NULL,
	"rows_in_file" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"skipped_duplicates" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"undone_at" timestamp,
	"undone_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_batch_record" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"record_id" text NOT NULL,
	"line" integer,
	"undone" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supervisory_visit" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"visit_date" date NOT NULL,
	"supervisor_id" text,
	"caregiver_id" text,
	"visit_type" text DEFAULT 'home' NOT NULL,
	"client_feedback" text,
	"care_plan_followed" boolean,
	"caregiver_feedback" text,
	"concerns" text,
	"follow_up_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "languages" text;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "payroll_worker_id" text;--> statement-breakpoint
ALTER TABLE "client_task_templates" ADD COLUMN "is_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "required_skills" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "preferred_caregiver_gender" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "preferred_language" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "supervisory_interval_days" integer;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "visit_text_optin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "visit_text_optin_at" timestamp;--> statement-breakpoint
ALTER TABLE "medication_logs" ADD COLUMN "dose_key" text;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD COLUMN "double_time_hours" numeric(8, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "autopay_attempt" ADD CONSTRAINT "autopay_attempt_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "autopay_attempt" ADD CONSTRAINT "autopay_attempt_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "autopay_attempt" ADD CONSTRAINT "autopay_attempt_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certification_reminder" ADD CONSTRAINT "certification_reminder_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certification_reminder" ADD CONSTRAINT "certification_reminder_certification_record_id_certification_records_id_fk" FOREIGN KEY ("certification_record_id") REFERENCES "public"."certification_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certification_reminder" ADD CONSTRAINT "certification_reminder_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_autopay" ADD CONSTRAINT "client_autopay_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_autopay" ADD CONSTRAINT "client_autopay_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_ltc_policy" ADD CONSTRAINT "client_ltc_policy_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_ltc_policy" ADD CONSTRAINT "client_ltc_policy_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_visit_text" ADD CONSTRAINT "family_visit_text_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_visit_text" ADD CONSTRAINT "family_visit_text_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_visit_text" ADD CONSTRAINT "family_visit_text_family_member_id_family_members_id_fk" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_batch_record" ADD CONSTRAINT "import_batch_record_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_batch_record" ADD CONSTRAINT "import_batch_record_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supervisory_visit" ADD CONSTRAINT "supervisory_visit_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supervisory_visit" ADD CONSTRAINT "supervisory_visit_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supervisory_visit" ADD CONSTRAINT "supervisory_visit_supervisor_id_user_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supervisory_visit" ADD CONSTRAINT "supervisory_visit_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "autopay_attempt_key" ON "autopay_attempt" USING btree ("invoice_id","attempt_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "autopay_attempt_company_idx" ON "autopay_attempt" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certification_reminder_company_id_idx" ON "certification_reminder" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "certification_reminder_key" ON "certification_reminder" USING btree ("certification_record_id","expiry_date","stage");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_autopay_client_key" ON "client_autopay" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_autopay_company_idx" ON "client_autopay" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_ltc_policy_client_key" ON "client_ltc_policy" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_visit_text_company_id_idx" ON "family_visit_text" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "family_visit_text_key" ON "family_visit_text" USING btree ("time_entry_id","family_member_id","event");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_batch_company_idx" ON "import_batch" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_batch_record_batch_idx" ON "import_batch_record" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supervisory_visit_company_client_idx" ON "supervisory_visit" USING btree ("company_id","client_id","visit_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "medication_logs_dose_key_idx" ON "medication_logs" USING btree ("dose_key");