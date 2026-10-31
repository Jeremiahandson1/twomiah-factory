CREATE TABLE IF NOT EXISTS "quote_proposal_option" (
	"id" text PRIMARY KEY NOT NULL,
	"quote_id" text NOT NULL,
	"name" text NOT NULL,
	"tier" text,
	"brand" text,
	"warranty" text,
	"description" text,
	"photos" json,
	"recommended" boolean DEFAULT false NOT NULL,
	"chosen" boolean DEFAULT false NOT NULL,
	"chosen_at" timestamp,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvass_territory" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#2563eb' NOT NULL,
	"boundary" json,
	"zips" json DEFAULT '[]'::json NOT NULL,
	"storm_event_id" text,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvass_territory_rep" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"territory_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE IF NOT EXISTS "mortgage_check" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"mortgage_company" text NOT NULL,
	"loan_number" text,
	"check_number" text,
	"amount" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp,
	"sent_at" timestamp,
	"tracking_number" text,
	"endorsed_at" timestamp,
	"deposited_at" timestamp,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roof_pipeline_config" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"config" json DEFAULT '{}'::json NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_order" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"crew_id" text,
	"title" text NOT NULL,
	"scope" text,
	"address" text,
	"start_date" timestamp,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"material_lines" json DEFAULT '[]'::json NOT NULL,
	"photo_ids" json DEFAULT '[]'::json NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"public_token" text,
	"token_expires_at" timestamp,
	"sent_at" timestamp,
	"responded_at" timestamp,
	"responded_by_name" text,
	"reject_reason" text,
	"completed_at" timestamp,
	"completion_note" text,
	"completion_photo_ids" json DEFAULT '[]'::json NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "shared_with_customer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "proposal_option_id" text;--> statement-breakpoint
ALTER TABLE "job_photo" ADD COLUMN "latitude" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "job_photo" ADD COLUMN "longitude" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "job_photo" ADD COLUMN "shared_with_customer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crew" ADD COLUMN "pay_per_square" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "insurance_claim" ADD COLUMN "depreciation_reminded_at" timestamp;--> statement-breakpoint
ALTER TABLE "insurance_claim" ADD COLUMN "completion_certificate_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "insurance_claim" ADD COLUMN "depreciation_recovered_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "insurance_claim" ADD COLUMN "depreciation_recovered_at" timestamp;--> statement-breakpoint
ALTER TABLE "storm_event" ADD COLUMN "path" json;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote_proposal_option" ADD CONSTRAINT "quote_proposal_option_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvass_territory" ADD CONSTRAINT "canvass_territory_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvass_territory" ADD CONSTRAINT "canvass_territory_storm_event_id_storm_event_id_fk" FOREIGN KEY ("storm_event_id") REFERENCES "public"."storm_event"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvass_territory" ADD CONSTRAINT "canvass_territory_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvass_territory_rep" ADD CONSTRAINT "canvass_territory_rep_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvass_territory_rep" ADD CONSTRAINT "canvass_territory_rep_territory_id_canvass_territory_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."canvass_territory"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvass_territory_rep" ADD CONSTRAINT "canvass_territory_rep_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
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
DO $$ BEGIN
 ALTER TABLE "mortgage_check" ADD CONSTRAINT "mortgage_check_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mortgage_check" ADD CONSTRAINT "mortgage_check_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mortgage_check" ADD CONSTRAINT "mortgage_check_claim_id_insurance_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."insurance_claim"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mortgage_check" ADD CONSTRAINT "mortgage_check_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roof_pipeline_config" ADD CONSTRAINT "roof_pipeline_config_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order" ADD CONSTRAINT "work_order_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order" ADD CONSTRAINT "work_order_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order" ADD CONSTRAINT "work_order_crew_id_crew_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crew"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order" ADD CONSTRAINT "work_order_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_proposal_option_quote_id_idx" ON "quote_proposal_option" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvass_territory_company_id_idx" ON "canvass_territory" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvass_territory_rep_company_id_idx" ON "canvass_territory_rep" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "canvass_territory_rep_territory_user_uniq" ON "canvass_territory_rep" USING btree ("territory_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvass_territory_rep_user_id_idx" ON "canvass_territory_rep" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_report_company_id_idx" ON "inspection_report" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_report_job_id_idx" ON "inspection_report" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mortgage_check_company_id_idx" ON "mortgage_check" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mortgage_check_claim_id_idx" ON "mortgage_check" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "roof_pipeline_config_company_id_idx" ON "roof_pipeline_config" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_company_id_idx" ON "work_order" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_job_id_idx" ON "work_order" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_public_token_uniq" ON "work_order" USING btree ("public_token");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote_line_item" ADD CONSTRAINT "quote_line_item_proposal_option_id_quote_proposal_option_id_fk" FOREIGN KEY ("proposal_option_id") REFERENCES "public"."quote_proposal_option"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_line_item_proposal_option_id_idx" ON "quote_line_item" USING btree ("proposal_option_id");