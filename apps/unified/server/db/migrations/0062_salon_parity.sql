CREATE TABLE IF NOT EXISTS "book_block_type" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#94a3b8' NOT NULL,
	"default_min" integer DEFAULT 60 NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "book_preference" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"slot_min" integer DEFAULT 15 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booth_rent_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"renter_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"card_id" text,
	"period" date NOT NULL,
	"attempt" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text NOT NULL,
	"payment_intent_id" text,
	"failure_message" text,
	"backup_tried" boolean DEFAULT false NOT NULL,
	"retried_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booth_rent_period" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"renter_id" text NOT NULL,
	"period" date NOT NULL,
	"invoice_id" text,
	"amount_cents" integer NOT NULL,
	"status" text NOT NULL,
	"waived_reason" text,
	"waived_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booth_renter" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"team_member_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"rent_cents" integer NOT NULL,
	"frequency" text NOT NULL,
	"due_weekday" integer,
	"due_day" integer,
	"start_date" date NOT NULL,
	"next_due" date,
	"ended_on" date,
	"auto_charge" boolean DEFAULT false NOT NULL,
	"auto_charge_consent_at" timestamp,
	"auto_charge_consent_via" text,
	"auto_charge_consent_user_id" text,
	"paused_for_payment_at" timestamp,
	"card_token" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intake_request" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"form_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"channel" text,
	"reason" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offer_code" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"code" text NOT NULL,
	"source" text NOT NULL,
	"send_id" text,
	"discount_type" text NOT NULL,
	"value" integer NOT NULL,
	"expires_on" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"used_at" timestamp,
	"used_invoice_id" text,
	"discount_cents" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "patch_test" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"tested_at" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"title" text,
	"description" text,
	"ran_by_user_id" text,
	"ran_by_name" text,
	"appointment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sale_receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"to_email" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sale_tip_split" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"stylist_id" text,
	"stylist_member_id" text,
	"share_bp" integer NOT NULL,
	"set_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_closed_period" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_purchase_order" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"location_id" text,
	"note" text,
	"sent_at" timestamp,
	"sent_to" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_purchase_order_line" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"purchase_order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"received" integer DEFAULT 0 NOT NULL,
	"unit_cost_cents" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_sale_seller" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"payee_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_stock_location" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_supplier" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_time_off" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"stylist_id" text,
	"stylist_member_id" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"reason" text,
	"requested_by" text,
	"decided_by" text,
	"decided_at" timestamp,
	"decision_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commission" ADD COLUMN "units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commission" ADD COLUMN "original_base" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "commission" ADD COLUMN "original_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "commission" ADD COLUMN "refunded_ratio" numeric(6, 5) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_plan" ADD COLUMN "tier_basis" text DEFAULT 'sales' NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_plan" ADD COLUMN "tier_cadence" text DEFAULT 'month' NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_plan" ADD COLUMN "scope" json DEFAULT '{}'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "book_block" ADD COLUMN "type_id" text;--> statement-breakpoint
ALTER TABLE "book_block" ADD COLUMN "type_name" text;--> statement-breakpoint
ALTER TABLE "book_block" ADD COLUMN "type_color" text;--> statement-breakpoint
ALTER TABLE "book_block" ADD COLUMN "paid" boolean;--> statement-breakpoint
ALTER TABLE "book_block" ADD COLUMN "series_id" text;--> statement-breakpoint
ALTER TABLE "card_fee_charge" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_fee_charge" ADD COLUMN "refunded_at" timestamp;--> statement-breakpoint
ALTER TABLE "card_fee_charge" ADD COLUMN "refund_id" text;--> statement-breakpoint
ALTER TABLE "card_fee_charge" ADD COLUMN "refunded_by_user_id" text;--> statement-breakpoint
ALTER TABLE "card_fee_charge" ADD COLUMN "refund_reason" text;--> statement-breakpoint
ALTER TABLE "card_policy" ADD COLUMN "no_show_fee_new_cents" integer;--> statement-breakpoint
ALTER TABLE "card_policy" ADD COLUMN "no_show_fee_new_percent" integer;--> statement-breakpoint
ALTER TABLE "card_policy" ADD COLUMN "late_cancel_fee_new_cents" integer;--> statement-breakpoint
ALTER TABLE "card_policy" ADD COLUMN "late_cancel_fee_new_percent" integer;--> statement-breakpoint
ALTER TABLE "card_policy" ADD COLUMN "min_booking_value_cents" integer;--> statement-breakpoint
ALTER TABLE "card_policy" ADD COLUMN "auto_charge_no_show" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "intake_form" ADD COLUMN "membership_plan_ids" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "intake_form" ADD COLUMN "valid_for_days" integer;--> statement-breakpoint
ALTER TABLE "intake_form" ADD COLUMN "before_confirm" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "intake_form" ADD COLUMN "signature" text DEFAULT 'typed' NOT NULL;--> statement-breakpoint
ALTER TABLE "intake_response" ADD COLUMN "files" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "intake_response" ADD COLUMN "signature_key" text;--> statement-breakpoint
ALTER TABLE "intake_response" ADD COLUMN "signature_type" text;--> statement-breakpoint
ALTER TABLE "intake_response" ADD COLUMN "expires_on" text;--> statement-breakpoint
ALTER TABLE "intake_response" ADD COLUMN "via" text DEFAULT 'booking' NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_charge" ADD COLUMN "backup_tried" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_charge" ADD COLUMN "retried_by_user_id" text;--> statement-breakpoint
ALTER TABLE "membership_enrollment" ADD COLUMN "sold_by" text;--> statement-breakpoint
ALTER TABLE "salon_gift_card" ADD COLUMN "bonus_granted_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "salon_gift_card" ADD COLUMN "bonus_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "salon_gift_card" ADD COLUMN "bonus_expires_on" text;--> statement-breakpoint
ALTER TABLE "salon_gift_card" ADD COLUMN "deliver_on" text;--> statement-breakpoint
ALTER TABLE "salon_gift_card" ADD COLUMN "delivered_at" timestamp;--> statement-breakpoint
ALTER TABLE "salon_gift_card" ADD COLUMN "source" text DEFAULT 'desk' NOT NULL;--> statement-breakpoint
ALTER TABLE "salon_gift_card" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "salon_retail_product" ADD COLUMN "reorder_qty" integer;--> statement-breakpoint
ALTER TABLE "salon_retail_product" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "salon_retail_product" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "salon_retail_product" ADD COLUMN "supplier_id" text;--> statement-breakpoint
ALTER TABLE "salon_retail_sale" ADD COLUMN "unit_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "salon_retail_sale" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "salon_retail_sale" ADD COLUMN "stylist_id" text;--> statement-breakpoint
ALTER TABLE "salon_retail_sale" ADD COLUMN "stylist_member_id" text;--> statement-breakpoint
ALTER TABLE "salon_stock_move" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "salon_stock_move" ADD COLUMN "transfer_id" text;--> statement-breakpoint
ALTER TABLE "salon_stock_move" ADD COLUMN "purchase_order_id" text;--> statement-breakpoint
ALTER TABLE "salon_stock_move" ADD COLUMN "invoice_id" text;--> statement-breakpoint
ALTER TABLE "service_menu" ADD COLUMN "prepay_online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_menu" ADD COLUMN "no_show_fee_cents" integer;--> statement-breakpoint
ALTER TABLE "service_menu" ADD COLUMN "no_show_fee_percent" integer;--> statement-breakpoint
ALTER TABLE "service_menu" ADD COLUMN "late_cancel_fee_cents" integer;--> statement-breakpoint
ALTER TABLE "service_menu" ADD COLUMN "late_cancel_fee_percent" integer;--> statement-breakpoint
ALTER TABLE "loyalty_members" ADD COLUMN "tier_min" integer;--> statement-breakpoint
ALTER TABLE "loyalty_members" ADD COLUMN "tier_at" timestamp;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "hold_from" timestamp;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "keep_card" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_service" ADD COLUMN "prepay" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "book_block_type" ADD CONSTRAINT "book_block_type_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "book_preference" ADD CONSTRAINT "book_preference_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "book_preference" ADD CONSTRAINT "book_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_charge" ADD CONSTRAINT "booth_rent_charge_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_charge" ADD CONSTRAINT "booth_rent_charge_renter_id_booth_renter_id_fk" FOREIGN KEY ("renter_id") REFERENCES "public"."booth_renter"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_charge" ADD CONSTRAINT "booth_rent_charge_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_charge" ADD CONSTRAINT "booth_rent_charge_card_id_client_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."client_card"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_charge" ADD CONSTRAINT "booth_rent_charge_retried_by_user_id_user_id_fk" FOREIGN KEY ("retried_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_period" ADD CONSTRAINT "booth_rent_period_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_period" ADD CONSTRAINT "booth_rent_period_renter_id_booth_renter_id_fk" FOREIGN KEY ("renter_id") REFERENCES "public"."booth_renter"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_period" ADD CONSTRAINT "booth_rent_period_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_period" ADD CONSTRAINT "booth_rent_period_waived_by_user_id_user_id_fk" FOREIGN KEY ("waived_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_renter" ADD CONSTRAINT "booth_renter_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_renter" ADD CONSTRAINT "booth_renter_team_member_id_team_member_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_member"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_renter" ADD CONSTRAINT "booth_renter_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_renter" ADD CONSTRAINT "booth_renter_auto_charge_consent_user_id_user_id_fk" FOREIGN KEY ("auto_charge_consent_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_request" ADD CONSTRAINT "intake_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_request" ADD CONSTRAINT "intake_request_form_id_intake_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."intake_form"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_request" ADD CONSTRAINT "intake_request_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offer_code" ADD CONSTRAINT "offer_code_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offer_code" ADD CONSTRAINT "offer_code_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offer_code" ADD CONSTRAINT "offer_code_used_invoice_id_invoice_id_fk" FOREIGN KEY ("used_invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patch_test" ADD CONSTRAINT "patch_test_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patch_test" ADD CONSTRAINT "patch_test_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patch_test" ADD CONSTRAINT "patch_test_ran_by_user_id_user_id_fk" FOREIGN KEY ("ran_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patch_test" ADD CONSTRAINT "patch_test_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_receipt" ADD CONSTRAINT "sale_receipt_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_receipt" ADD CONSTRAINT "sale_receipt_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_tip_split" ADD CONSTRAINT "sale_tip_split_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_tip_split" ADD CONSTRAINT "sale_tip_split_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_tip_split" ADD CONSTRAINT "sale_tip_split_stylist_id_user_id_fk" FOREIGN KEY ("stylist_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_tip_split" ADD CONSTRAINT "sale_tip_split_stylist_member_id_team_member_id_fk" FOREIGN KEY ("stylist_member_id") REFERENCES "public"."team_member"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_tip_split" ADD CONSTRAINT "sale_tip_split_set_by_user_id_user_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_closed_period" ADD CONSTRAINT "salon_closed_period_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_purchase_order" ADD CONSTRAINT "salon_purchase_order_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_purchase_order" ADD CONSTRAINT "salon_purchase_order_supplier_id_salon_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."salon_supplier"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_purchase_order_line" ADD CONSTRAINT "salon_purchase_order_line_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_purchase_order_line" ADD CONSTRAINT "salon_purchase_order_line_purchase_order_id_salon_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."salon_purchase_order"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_purchase_order_line" ADD CONSTRAINT "salon_purchase_order_line_product_id_salon_retail_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."salon_retail_product"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_sale_seller" ADD CONSTRAINT "salon_sale_seller_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_sale_seller" ADD CONSTRAINT "salon_sale_seller_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_stock_location" ADD CONSTRAINT "salon_stock_location_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_supplier" ADD CONSTRAINT "salon_supplier_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_time_off" ADD CONSTRAINT "salon_time_off_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_time_off" ADD CONSTRAINT "salon_time_off_stylist_id_user_id_fk" FOREIGN KEY ("stylist_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_time_off" ADD CONSTRAINT "salon_time_off_stylist_member_id_team_member_id_fk" FOREIGN KEY ("stylist_member_id") REFERENCES "public"."team_member"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "book_block_type_company_name_idx" ON "book_block_type" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "book_preference_user_idx" ON "book_preference" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booth_rent_charge_invoice_attempt_idx" ON "booth_rent_charge" USING btree ("invoice_id","attempt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booth_rent_charge_company_idx" ON "booth_rent_charge" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booth_rent_charge_renter_idx" ON "booth_rent_charge" USING btree ("renter_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booth_rent_period_renter_period_idx" ON "booth_rent_period" USING btree ("renter_id","period");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booth_rent_period_invoice_idx" ON "booth_rent_period" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booth_rent_period_company_idx" ON "booth_rent_period" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booth_renter_company_member_idx" ON "booth_renter" USING btree ("company_id","team_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booth_renter_company_status_idx" ON "booth_renter" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booth_renter_card_token_idx" ON "booth_renter" USING btree ("card_token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intake_request_token_idx" ON "intake_request" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_request_form_idx" ON "intake_request" USING btree ("company_id","form_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_request_contact_idx" ON "intake_request" USING btree ("company_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offer_code_company_code" ON "offer_code" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offer_code_used_invoice" ON "offer_code" USING btree ("used_invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_code_company_created_idx" ON "offer_code" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_code_contact_idx" ON "offer_code" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patch_test_contact_idx" ON "patch_test" USING btree ("company_id","contact_id","tested_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "patch_test_appointment_unique" ON "patch_test" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sale_receipt_invoice_unique" ON "sale_receipt" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_tip_split_invoice_idx" ON "sale_tip_split" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_closed_period_company_start_idx" ON "salon_closed_period" USING btree ("company_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_purchase_order_number_key" ON "salon_purchase_order" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_purchase_order_supplier_idx" ON "salon_purchase_order" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_purchase_order_line_key" ON "salon_purchase_order_line" USING btree ("purchase_order_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_sale_seller_invoice_key" ON "salon_sale_seller" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_sale_seller_company_idx" ON "salon_sale_seller" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_stock_location_company_idx" ON "salon_stock_location" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_supplier_company_idx" ON "salon_supplier" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_time_off_company_start_idx" ON "salon_time_off" USING btree ("company_id","start_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_time_off_company_status_idx" ON "salon_time_off" USING btree ("company_id","status");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "book_block" ADD CONSTRAINT "book_block_type_id_book_block_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."book_block_type"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_fee_charge" ADD CONSTRAINT "card_fee_charge_refunded_by_user_id_user_id_fk" FOREIGN KEY ("refunded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_charge" ADD CONSTRAINT "membership_charge_retried_by_user_id_user_id_fk" FOREIGN KEY ("retried_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_retail_product" ADD CONSTRAINT "salon_retail_product_supplier_id_salon_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."salon_supplier"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commission_refund_once" ON "commission" USING btree ("reversal_of","refunded_ratio") WHERE source = 'refund';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_block_series_idx" ON "book_block" USING btree ("company_id","series_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_retail_product_barcode_key" ON "salon_retail_product" USING btree ("company_id","barcode");--> statement-breakpoint
-- A patch test already on a client's chart (a date and, once results were kept, a result; a date alone counted as passed) becomes the first entry of their history.
INSERT INTO "patch_test" ("id", "company_id", "contact_id", "tested_at", "status", "title", "created_at", "updated_at")
SELECT md5(cp."id" || 'patch-test'), c."company_id", cp."contact_id", cp."patch_test_at", COALESCE(cp."patch_test_result", 'passed'), 'Patch test', now(), now()
FROM "client_profile" cp JOIN "contact" c ON c."id" = cp."contact_id"
WHERE cp."patch_test_at" IS NOT NULL;--> statement-breakpoint
UPDATE "salon_gift_card" SET "delivered_at" = "created_at" WHERE "recipient_email" IS NOT NULL;