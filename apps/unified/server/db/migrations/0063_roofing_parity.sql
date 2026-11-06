CREATE TABLE IF NOT EXISTS "job_person" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_proposal_document" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"quote_id" text NOT NULL,
	"cover_title" text,
	"cover_subtitle" text,
	"cover_photo" text,
	"about_us" text,
	"sections" json,
	"terms_clauses" json,
	"attachments" json,
	"cosigner_name" text,
	"cosigner_email" text,
	"cosigner_role" text,
	"cosigner_token" text,
	"cosigner_requested_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quote_proposal_document_quote_id_unique" UNIQUE("quote_id"),
	CONSTRAINT "quote_proposal_document_cosigner_token_unique" UNIQUE("cosigner_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_proposal_mark" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"quote_id" text NOT NULL,
	"kind" text NOT NULL,
	"clause_id" text,
	"name" text,
	"initials" text,
	"signature" text,
	"document_hash" text,
	"signed_ip" text,
	"signed_user_agent" text,
	"signed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commission_disclaimer_acceptance" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"version" integer NOT NULL,
	"disclaimer_text" text NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inspection_report_template" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"intro" text,
	"sections" json DEFAULT '[]'::json NOT NULL,
	"layout" json,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE IF NOT EXISTS "material_list_template" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"assumptions" json NOT NULL,
	"extra_lines" json NOT NULL,
	"supplier" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roof_money_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"min_profit_kind" text,
	"min_profit_value" numeric(12, 2),
	"commission_viewer_roles" json,
	"commission_disclaimer" text,
	"commission_disclaimer_version" integer DEFAULT 0 NOT NULL,
	"require_worksheet_approval" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplement_status" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"base_status" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_price_item" (
	"id" text PRIMARY KEY NOT NULL,
	"price_list_id" text NOT NULL,
	"code" text,
	"sku" text,
	"description" text NOT NULL,
	"unit" text DEFAULT 'ea' NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_price_list" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"supplier" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commission" ADD COLUMN "earn_key" text;--> statement-breakpoint
ALTER TABLE "commission_plan" ADD COLUMN "measured_on" text DEFAULT 'contract' NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_plan" ADD COLUMN "trigger_on" text DEFAULT 'collected' NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_plan" ADD COLUMN "zero_balance_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "qb_customer_id" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "qb_customer_name" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "option_discount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "option_role" text;--> statement-breakpoint
ALTER TABLE "quote_proposal_option" ADD COLUMN "discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_proposal_option" ADD COLUMN "discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_proposal_option" ADD COLUMN "attachments" json;--> statement-breakpoint
ALTER TABLE "job_photo" ADD COLUMN "source_photo_id" text;--> statement-breakpoint
ALTER TABLE "job_photo" ADD COLUMN "markup" json;--> statement-breakpoint
ALTER TABLE "inspection_report" ADD COLUMN "layout" json;--> statement-breakpoint
ALTER TABLE "inspection_report" ADD COLUMN "sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "inspection_report" ADD COLUMN "sent_via" text;--> statement-breakpoint
ALTER TABLE "inspection_report" ADD COLUMN "copies" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "po_number" text;--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "price_list_id" text;--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "send_log" json;--> statement-breakpoint
ALTER TABLE "supplement" ADD COLUMN "custom_status_id" text;--> statement-breakpoint
ALTER TABLE "supplement" ADD COLUMN "custom_status_at" timestamp;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "price" numeric(12, 2);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_person" ADD CONSTRAINT "job_person_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_person" ADD CONSTRAINT "job_person_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_person" ADD CONSTRAINT "job_person_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote_proposal_document" ADD CONSTRAINT "quote_proposal_document_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote_proposal_document" ADD CONSTRAINT "quote_proposal_document_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote_proposal_mark" ADD CONSTRAINT "quote_proposal_mark_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote_proposal_mark" ADD CONSTRAINT "quote_proposal_mark_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commission_disclaimer_acceptance" ADD CONSTRAINT "commission_disclaimer_acceptance_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_report_template" ADD CONSTRAINT "inspection_report_template_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_report_template" ADD CONSTRAINT "inspection_report_template_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
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
DO $$ BEGIN
 ALTER TABLE "material_list_template" ADD CONSTRAINT "material_list_template_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_list_template" ADD CONSTRAINT "material_list_template_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roof_money_setting" ADD CONSTRAINT "roof_money_setting_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplement_status" ADD CONSTRAINT "supplement_status_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplier_price_item" ADD CONSTRAINT "supplier_price_item_price_list_id_supplier_price_list_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."supplier_price_list"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplier_price_list" ADD CONSTRAINT "supplier_price_list_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_person_job_id_idx" ON "job_person" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_person_user_id_idx" ON "job_person" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_person_job_user_role_idx" ON "job_person" USING btree ("job_id","user_id","role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_proposal_mark_quote_id_idx" ON "quote_proposal_mark" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commission_disclaimer_acceptance_user_version_idx" ON "commission_disclaimer_acceptance" USING btree ("user_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_disclaimer_acceptance_company_id_idx" ON "commission_disclaimer_acceptance" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_report_template_company_id_idx" ON "inspection_report_template" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inspection_report_template_company_name_uniq" ON "inspection_report_template" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_permit_company_id_idx" ON "job_permit" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_permit_job_id_idx" ON "job_permit" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_worksheet_approval_job_id_idx" ON "job_worksheet_approval" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_worksheet_approval_company_id_idx" ON "job_worksheet_approval" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_list_template_company_id_idx" ON "material_list_template" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "roof_money_setting_company_id_idx" ON "roof_money_setting" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplement_status_company_id_idx" ON "supplement_status" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supplement_status_company_name_idx" ON "supplement_status" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_price_item_price_list_id_idx" ON "supplier_price_item" USING btree ("price_list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_price_list_company_id_idx" ON "supplier_price_list" USING btree ("company_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material" ADD CONSTRAINT "material_price_list_id_supplier_price_list_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."supplier_price_list"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplement" ADD CONSTRAINT "supplement_custom_status_id_supplement_status_id_fk" FOREIGN KEY ("custom_status_id") REFERENCES "public"."supplement_status"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commission_earn_key_once" ON "commission" USING btree ("earn_key") WHERE earn_key IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_photo_source_photo_id_uniq" ON "job_photo" USING btree ("source_photo_id");