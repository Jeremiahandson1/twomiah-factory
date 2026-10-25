CREATE TABLE IF NOT EXISTS "bar_order" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer,
	"channel" text NOT NULL,
	"status" text DEFAULT 'awaiting_payment' NOT NULL,
	"name" text,
	"table_label" text,
	"phone" text,
	"email" text,
	"text_ok" boolean DEFAULT false NOT NULL,
	"lines" json DEFAULT '[]'::json NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"tax_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"tax_rate_bps" integer NOT NULL,
	"pickup_at" timestamp,
	"check_id" text,
	"stripe_account" text,
	"stripe_session_id" text,
	"payment_intent_id" text,
	"paid_at" timestamp,
	"received_notified_at" timestamp,
	"ready_at" timestamp,
	"ready_by_name" text,
	"ready_notified_at" timestamp,
	"collected_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_reader" (
	"id" text PRIMARY KEY NOT NULL,
	"stripe_reader_id" text NOT NULL,
	"stripe_account" text,
	"location_id" text,
	"label" text NOT NULL,
	"device_type" text,
	"serial_number" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_terminal_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"check_id" text,
	"order_id" text,
	"reader_id" text NOT NULL,
	"stripe_account" text,
	"payment_intent_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure" text,
	"payment_id" text,
	"started_by_id" text,
	"started_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bar_check_payment" ADD COLUMN "stripe_account" text;--> statement-breakpoint
ALTER TABLE "bar_check_payment" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bar_check_payment" ADD COLUMN "refunded_at" timestamp;--> statement-breakpoint
ALTER TABLE "bar_check_payment" ADD COLUMN "refund_reason" text;--> statement-breakpoint
ALTER TABLE "bar_check_payment" ADD COLUMN "refunded_by_name" text;--> statement-breakpoint
ALTER TABLE "bar_menu_item" ADD COLUMN "modifiers" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "bar_settings" ADD COLUMN "food_service" json DEFAULT '{}'::json NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_order" ADD CONSTRAINT "bar_order_check_id_bar_check_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."bar_check"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_order" ADD CONSTRAINT "bar_order_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_reader" ADD CONSTRAINT "bar_reader_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_terminal_charge" ADD CONSTRAINT "bar_terminal_charge_check_id_bar_check_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."bar_check"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_terminal_charge" ADD CONSTRAINT "bar_terminal_charge_started_by_id_user_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_terminal_charge" ADD CONSTRAINT "bar_terminal_charge_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_order_company_status_idx" ON "bar_order" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_order_session_key" ON "bar_order" USING btree ("company_id","stripe_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_reader_company_reader_key" ON "bar_reader" USING btree ("company_id","stripe_reader_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_terminal_charge_pi_key" ON "bar_terminal_charge" USING btree ("company_id","payment_intent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_terminal_charge_check_idx" ON "bar_terminal_charge" USING btree ("company_id","check_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_check_payment_provider_key" ON "bar_check_payment" USING btree ("company_id","provider_payment_id");