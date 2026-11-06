CREATE TABLE IF NOT EXISTS "event_bank_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event_payment_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"payment_intent_id" text NOT NULL,
	"stripe_account" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'awaiting' NOT NULL,
	"keep_for_autopay" boolean DEFAULT false NOT NULL,
	"consent_at" timestamp,
	"consent_ip" text,
	"consent_text" text,
	"bank_name" text,
	"last4" text,
	"verify_url" text,
	"failure_code" text,
	"failure_message" text,
	"initiated_at" timestamp,
	"settled_at" timestamp,
	"failed_at" timestamp,
	"notice_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_contract_template" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_form_campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"source" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_marketing_spend" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"month" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"note" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_proposal_signer" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"sent_at" timestamp,
	"signature" text,
	"signed_by" text,
	"signed_at" timestamp,
	"signed_ip" text,
	"signed_user_agent" text,
	"signature_hash" text,
	"consent_at" timestamp,
	"consent_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_report_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"report" text NOT NULL,
	"frequency" text NOT NULL,
	"weekday" integer,
	"month_day" integer,
	"recipients" json DEFAULT '[]'::json NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_availability_date" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"mode" text NOT NULL,
	"start_time" text,
	"end_time" text,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"decided_by_name" text,
	"decided_at" timestamp,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_declared_tip" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"business_day" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"original_cents" integer NOT NULL,
	"declared_via" text DEFAULT 'web' NOT NULL,
	"note" text,
	"corrected_by_name" text,
	"corrected_at" timestamp,
	"declared_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_invoice_scan" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'review' NOT NULL,
	"vendor_id" text,
	"supplier_name" text,
	"invoice_number" text,
	"invoice_date" text,
	"total_cents" integer,
	"lines" json DEFAULT '[]'::json NOT NULL,
	"notes" text,
	"file_key" text,
	"file_type" text,
	"file_name" text,
	"reader" text,
	"order_id" text,
	"created_by_name" text,
	"confirmed_by_name" text,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_tip_import" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"business_day" text NOT NULL,
	"external_staff_id" text,
	"tip_cents" integer NOT NULL,
	"paid_at" timestamp NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_tip_source" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"label" text,
	"external_account_id" text,
	"location_id" text,
	"credentials_enc" text NOT NULL,
	"token_expires_at" timestamp,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"last_import_at" timestamp,
	"connected_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_tip_staff_map" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"external_staff_id" text NOT NULL,
	"external_name" text,
	"external_email" text,
	"user_id" text,
	"matched_by" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bar_terminal_charge" ALTER COLUMN "reader_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "campaign_id" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "hold_until" date;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "hold_reminder_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "hold_released_at" timestamp;--> statement-breakpoint
ALTER TABLE "event_autopay" ADD COLUMN "method" text DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_autopay" ADD COLUMN "setup_method" text;--> statement-breakpoint
ALTER TABLE "event_proposal" ADD COLUMN "contract_template_id" text;--> statement-breakpoint
ALTER TABLE "event_proposal" ADD COLUMN "contract_name" text;--> statement-breakpoint
ALTER TABLE "event_proposal" ADD COLUMN "contract_body" text;--> statement-breakpoint
ALTER TABLE "event_proposal" ADD COLUMN "signer_plan" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "bar_menu_item" ADD COLUMN "stock_count" integer;--> statement-breakpoint
ALTER TABLE "bar_menu_item" ADD COLUMN "stock_count_reset" integer;--> statement-breakpoint
ALTER TABLE "bar_menu_item" ADD COLUMN "stock_counted_at" timestamp;--> statement-breakpoint
ALTER TABLE "bar_menu_section" ADD COLUMN "available_windows" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "bar_shift_request" ADD COLUMN "shift_stamp" text;--> statement-breakpoint
ALTER TABLE "bar_shift_request" ADD COLUMN "with_stamp" text;--> statement-breakpoint
ALTER TABLE "bar_stock_item" ADD COLUMN "bottle_tare_grams" integer;--> statement-breakpoint
ALTER TABLE "bar_stock_item" ADD COLUMN "bottle_full_grams" integer;--> statement-breakpoint
ALTER TABLE "bar_tip_payout" ADD COLUMN "declared_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bar_tip_payout" ADD COLUMN "imported_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_bank_payment" ADD CONSTRAINT "event_bank_payment_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_bank_payment" ADD CONSTRAINT "event_bank_payment_event_payment_id_event_payment_id_fk" FOREIGN KEY ("event_payment_id") REFERENCES "public"."event_payment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_bank_payment" ADD CONSTRAINT "event_bank_payment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_contract_template" ADD CONSTRAINT "event_contract_template_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_form_campaign" ADD CONSTRAINT "event_form_campaign_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_marketing_spend" ADD CONSTRAINT "event_marketing_spend_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_proposal_signer" ADD CONSTRAINT "event_proposal_signer_proposal_id_event_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."event_proposal"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_proposal_signer" ADD CONSTRAINT "event_proposal_signer_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_report_schedule" ADD CONSTRAINT "event_report_schedule_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_availability_date" ADD CONSTRAINT "bar_availability_date_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_availability_date" ADD CONSTRAINT "bar_availability_date_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_declared_tip" ADD CONSTRAINT "bar_declared_tip_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_declared_tip" ADD CONSTRAINT "bar_declared_tip_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_invoice_scan" ADD CONSTRAINT "bar_invoice_scan_vendor_id_bar_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."bar_vendor"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_invoice_scan" ADD CONSTRAINT "bar_invoice_scan_order_id_bar_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bar_purchase_order"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_invoice_scan" ADD CONSTRAINT "bar_invoice_scan_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tip_import" ADD CONSTRAINT "bar_tip_import_source_id_bar_tip_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."bar_tip_source"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tip_import" ADD CONSTRAINT "bar_tip_import_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tip_source" ADD CONSTRAINT "bar_tip_source_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tip_staff_map" ADD CONSTRAINT "bar_tip_staff_map_source_id_bar_tip_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."bar_tip_source"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tip_staff_map" ADD CONSTRAINT "bar_tip_staff_map_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tip_staff_map" ADD CONSTRAINT "bar_tip_staff_map_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_bank_payment_intent_idx" ON "event_bank_payment" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_bank_payment_event_payment_idx" ON "event_bank_payment" USING btree ("event_payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_bank_payment_company_id_idx" ON "event_bank_payment" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_contract_template_company_id_idx" ON "event_contract_template" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_form_campaign_token_idx" ON "event_form_campaign" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_form_campaign_company_id_idx" ON "event_form_campaign" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_marketing_spend_once_idx" ON "event_marketing_spend" USING btree ("company_id","source","month");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_proposal_signer_position_idx" ON "event_proposal_signer" USING btree ("proposal_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_proposal_signer_token_idx" ON "event_proposal_signer" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_proposal_signer_company_id_idx" ON "event_proposal_signer" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_report_schedule_company_id_idx" ON "event_report_schedule" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_availability_date_key" ON "bar_availability_date" USING btree ("company_id","user_id","day","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_availability_date_day_idx" ON "bar_availability_date" USING btree ("company_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_declared_tip_day_user_key" ON "bar_declared_tip" USING btree ("company_id","business_day","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_invoice_scan_company_idx" ON "bar_invoice_scan" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_tip_import_payment_key" ON "bar_tip_import" USING btree ("company_id","provider","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_tip_import_day_idx" ON "bar_tip_import" USING btree ("company_id","business_day");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_tip_source_provider_key" ON "bar_tip_source" USING btree ("company_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_tip_staff_map_key" ON "bar_tip_staff_map" USING btree ("source_id","external_staff_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event" ADD CONSTRAINT "event_campaign_id_event_form_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."event_form_campaign"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
