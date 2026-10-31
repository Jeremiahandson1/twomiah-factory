CREATE TABLE IF NOT EXISTS "appointment_item" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"position" integer NOT NULL,
	"service_id" text,
	"stylist_id" text,
	"stylist_member_id" text,
	"start_offset_min" integer NOT NULL,
	"duration_min" integer NOT NULL,
	"processing_after_min" integer,
	"processing_min" integer,
	"price" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "book_block" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"stylist_id" text,
	"stylist_member_id" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"reason" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_fee_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"appointment_id" text,
	"card_id" text,
	"kind" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"payment_intent_id" text,
	"failure_message" text,
	"charged_by_user_id" text,
	"receipt_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"card_requirement" text DEFAULT 'off' NOT NULL,
	"no_show_fee_amount" numeric(10, 2),
	"no_show_fee_percent" integer,
	"late_cancel_window_minutes" integer,
	"late_cancel_fee_amount" numeric(10, 2),
	"late_cancel_fee_percent" integer,
	"policy_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_card" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"stripe_account" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"payment_method_id" text NOT NULL,
	"brand" text,
	"last4" text,
	"exp_month" integer,
	"exp_year" integer,
	"consent_at" timestamp NOT NULL,
	"consent_text" text NOT NULL,
	"consent_via" text NOT NULL,
	"consent_user_id" text,
	"removed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intake_form" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'intake' NOT NULL,
	"intro" text,
	"questions" json DEFAULT '[]'::json NOT NULL,
	"service_ids" json DEFAULT '[]'::json NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intake_response" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"form_id" text,
	"form_name" text NOT NULL,
	"form_kind" text DEFAULT 'intake' NOT NULL,
	"contact_id" text NOT NULL,
	"booking_token" text,
	"answers" json DEFAULT '[]'::json NOT NULL,
	"signed_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "membership_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"enrollment_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"card_id" text,
	"period" date NOT NULL,
	"attempt" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"status" text NOT NULL,
	"payment_intent_id" text,
	"failure_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retention_send" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"kind" text NOT NULL,
	"event_key" text NOT NULL,
	"channel" text,
	"status" text NOT NULL,
	"reason" text,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_gift_card" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"initial_cents" integer NOT NULL,
	"balance_cents" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invoice_id" text,
	"purchaser_contact_id" text,
	"purchaser_name" text,
	"purchaser_email" text,
	"recipient_name" text,
	"recipient_email" text,
	"message" text,
	"sold_by_name" text,
	"voided_at" timestamp,
	"void_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_gift_card_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"card_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"kind" text NOT NULL,
	"invoice_id" text,
	"by_name" text,
	"note" text,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_reader" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"stripe_reader_id" text NOT NULL,
	"stripe_account" text NOT NULL,
	"location_id" text NOT NULL,
	"label" text NOT NULL,
	"device_type" text,
	"serial_number" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_retail_product" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"sku" text,
	"price_cents" integer NOT NULL,
	"cost_cents" integer,
	"reorder_at" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_retail_sale" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"product_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"line_item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_stock_move" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"by_name" text,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_terminal_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"reader_id" text NOT NULL,
	"stripe_account" text NOT NULL,
	"payment_intent_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure" text,
	"payment_id" text,
	"started_by_id" text,
	"started_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commission_plan" ADD COLUMN "sales_kind" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "cancelled_at" timestamp;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "processing_after_min" integer;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "processing_min" integer;--> statement-breakpoint
ALTER TABLE "client_profile" ADD COLUMN "patch_test_result" text;--> statement-breakpoint
ALTER TABLE "membership_enrollment" ADD COLUMN "auto_charge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_enrollment" ADD COLUMN "auto_charge_consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "membership_enrollment" ADD COLUMN "auto_charge_consent_user_id" text;--> statement-breakpoint
ALTER TABLE "membership_enrollment" ADD COLUMN "paused_for_payment_at" timestamp;--> statement-breakpoint
ALTER TABLE "membership_enrollment" ADD COLUMN "card_update_token" text;--> statement-breakpoint
ALTER TABLE "service_menu" ADD COLUMN "processing_after_min" integer;--> statement-breakpoint
ALTER TABLE "service_menu" ADD COLUMN "processing_min" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_item" ADD CONSTRAINT "appointment_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_item" ADD CONSTRAINT "appointment_item_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_item" ADD CONSTRAINT "appointment_item_service_id_service_menu_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_menu"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_item" ADD CONSTRAINT "appointment_item_stylist_id_user_id_fk" FOREIGN KEY ("stylist_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_item" ADD CONSTRAINT "appointment_item_stylist_member_id_team_member_id_fk" FOREIGN KEY ("stylist_member_id") REFERENCES "public"."team_member"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "book_block" ADD CONSTRAINT "book_block_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "book_block" ADD CONSTRAINT "book_block_stylist_id_user_id_fk" FOREIGN KEY ("stylist_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "book_block" ADD CONSTRAINT "book_block_stylist_member_id_team_member_id_fk" FOREIGN KEY ("stylist_member_id") REFERENCES "public"."team_member"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_fee_charge" ADD CONSTRAINT "card_fee_charge_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_fee_charge" ADD CONSTRAINT "card_fee_charge_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_fee_charge" ADD CONSTRAINT "card_fee_charge_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_fee_charge" ADD CONSTRAINT "card_fee_charge_card_id_client_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."client_card"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_fee_charge" ADD CONSTRAINT "card_fee_charge_charged_by_user_id_user_id_fk" FOREIGN KEY ("charged_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_policy" ADD CONSTRAINT "card_policy_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_card" ADD CONSTRAINT "client_card_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_card" ADD CONSTRAINT "client_card_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_card" ADD CONSTRAINT "client_card_consent_user_id_user_id_fk" FOREIGN KEY ("consent_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_form" ADD CONSTRAINT "intake_form_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_response" ADD CONSTRAINT "intake_response_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_response" ADD CONSTRAINT "intake_response_form_id_intake_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."intake_form"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_response" ADD CONSTRAINT "intake_response_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_charge" ADD CONSTRAINT "membership_charge_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_charge" ADD CONSTRAINT "membership_charge_enrollment_id_membership_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."membership_enrollment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_charge" ADD CONSTRAINT "membership_charge_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_charge" ADD CONSTRAINT "membership_charge_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_charge" ADD CONSTRAINT "membership_charge_card_id_client_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."client_card"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retention_send" ADD CONSTRAINT "retention_send_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retention_send" ADD CONSTRAINT "retention_send_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_gift_card" ADD CONSTRAINT "salon_gift_card_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_gift_card" ADD CONSTRAINT "salon_gift_card_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_gift_card" ADD CONSTRAINT "salon_gift_card_purchaser_contact_id_contact_id_fk" FOREIGN KEY ("purchaser_contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_gift_card_ledger" ADD CONSTRAINT "salon_gift_card_ledger_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_gift_card_ledger" ADD CONSTRAINT "salon_gift_card_ledger_card_id_salon_gift_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."salon_gift_card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_reader" ADD CONSTRAINT "salon_reader_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_retail_product" ADD CONSTRAINT "salon_retail_product_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_retail_sale" ADD CONSTRAINT "salon_retail_sale_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_retail_sale" ADD CONSTRAINT "salon_retail_sale_product_id_salon_retail_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."salon_retail_product"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_retail_sale" ADD CONSTRAINT "salon_retail_sale_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_retail_sale" ADD CONSTRAINT "salon_retail_sale_line_item_id_invoice_line_item_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."invoice_line_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_stock_move" ADD CONSTRAINT "salon_stock_move_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_stock_move" ADD CONSTRAINT "salon_stock_move_product_id_salon_retail_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."salon_retail_product"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_terminal_charge" ADD CONSTRAINT "salon_terminal_charge_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_terminal_charge" ADD CONSTRAINT "salon_terminal_charge_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_terminal_charge" ADD CONSTRAINT "salon_terminal_charge_reader_id_salon_reader_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."salon_reader"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_item_appointment_id_idx" ON "appointment_item" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_item_stylist_idx" ON "appointment_item" USING btree ("company_id","stylist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_block_company_start_idx" ON "book_block" USING btree ("company_id","start_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_fee_charge_company_idx" ON "card_fee_charge" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_fee_charge_appointment_idx" ON "card_fee_charge" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_fee_charge_contact_idx" ON "card_fee_charge" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_policy_company_id_key" ON "card_policy" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_card_client_idx" ON "client_card" USING btree ("company_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_card_payment_method_key" ON "client_card" USING btree ("company_id","payment_method_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_form_company_idx" ON "intake_form" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_response_contact_idx" ON "intake_response" USING btree ("company_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intake_response_once_idx" ON "intake_response" USING btree ("form_id","contact_id","booking_token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "membership_charge_invoice_attempt_idx" ON "membership_charge" USING btree ("invoice_id","attempt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "membership_charge_company_id_idx" ON "membership_charge" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "membership_charge_enrollment_id_idx" ON "membership_charge" USING btree ("enrollment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "retention_send_once" ON "retention_send" USING btree ("company_id","contact_id","kind","event_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_send_company_created_idx" ON "retention_send" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_gift_card_company_code_key" ON "salon_gift_card" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_gift_card_company_invoice_key" ON "salon_gift_card" USING btree ("company_id","invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_gift_card_ledger_card_idx" ON "salon_gift_card_ledger" USING btree ("card_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_gift_card_ledger_invoice_idx" ON "salon_gift_card_ledger" USING btree ("company_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_reader_company_reader_key" ON "salon_reader" USING btree ("company_id","stripe_reader_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_retail_product_company_idx" ON "salon_retail_product" USING btree ("company_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_retail_sale_line_key" ON "salon_retail_sale" USING btree ("line_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_retail_sale_product_idx" ON "salon_retail_sale" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_retail_sale_invoice_idx" ON "salon_retail_sale" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_stock_move_product_idx" ON "salon_stock_move" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_terminal_charge_pi_key" ON "salon_terminal_charge" USING btree ("company_id","payment_intent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_terminal_charge_invoice_idx" ON "salon_terminal_charge" USING btree ("invoice_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_enrollment" ADD CONSTRAINT "membership_enrollment_auto_charge_consent_user_id_user_id_fk" FOREIGN KEY ("auto_charge_consent_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
