-- The register and the grill (services/barRegister.ts, barKitchen.ts): checks, their items and payments,
-- grill tickets, and the night's close-out. Plus the till PIN on a login user, the check counter and the grill
-- screen's thresholds on bar_settings, and each menu item's grill settings.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "pin_hash" text;
--> statement-breakpoint
ALTER TABLE "bar_settings" ADD COLUMN IF NOT EXISTS "check_seq" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "bar_settings" ADD COLUMN IF NOT EXISTS "ticket_warn_seconds" integer DEFAULT 600 NOT NULL;
--> statement-breakpoint
ALTER TABLE "bar_settings" ADD COLUMN IF NOT EXISTS "ticket_late_seconds" integer DEFAULT 900 NOT NULL;
--> statement-breakpoint
ALTER TABLE "bar_settings" ADD COLUMN IF NOT EXISTS "default_prep_seconds" integer DEFAULT 480 NOT NULL;
--> statement-breakpoint
ALTER TABLE "bar_menu_item" ADD COLUMN IF NOT EXISTS "to_kitchen" boolean;
--> statement-breakpoint
ALTER TABLE "bar_menu_item" ADD COLUMN IF NOT EXISTS "prep_seconds" integer;
--> statement-breakpoint
ALTER TABLE "bar_menu_item" ADD COLUMN IF NOT EXISTS "learned_prep_seconds" integer;
--> statement-breakpoint
ALTER TABLE "bar_menu_item" ADD COLUMN IF NOT EXISTS "learned_samples" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_check" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"spot" text,
	"note" text,
	"contact_id" text REFERENCES "contact"("id") ON DELETE set null,
	"status" text DEFAULT 'open' NOT NULL,
	"void_reason" text,
	"split_from_id" text,
	"subtotal_cents" integer,
	"tax_cents" integer,
	"total_cents" integer,
	"tip_cents" integer,
	"tax_rate_bps" integer,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"opened_by_id" text REFERENCES "user"("id") ON DELETE set null,
	"opened_by_name" text,
	"closed_at" timestamp,
	"closed_by_id" text REFERENCES "user"("id") ON DELETE set null,
	"closed_by_name" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_check_company_number_key" ON "bar_check" ("company_id","number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_check_company_status_idx" ON "bar_check" ("company_id","status","opened_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_check_company_closed_idx" ON "bar_check" ("company_id","closed_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_check_item" (
	"id" text PRIMARY KEY NOT NULL,
	"check_id" text NOT NULL REFERENCES "bar_check"("id") ON DELETE cascade,
	"menu_item_id" text REFERENCES "bar_menu_item"("id") ON DELETE set null,
	"tap_id" text REFERENCES "bar_tap"("id") ON DELETE set null,
	"name" text NOT NULL,
	"size" text,
	"qty" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"note" text,
	"seat" integer,
	"to_kitchen" boolean DEFAULT true NOT NULL,
	"kind" text DEFAULT 'item' NOT NULL,
	"state" text DEFAULT 'held' NOT NULL,
	"ticket_id" text,
	"void_reason" text,
	"voided_by_name" text,
	"added_by_id" text REFERENCES "user"("id") ON DELETE set null,
	"added_by_name" text,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_check_item_check_idx" ON "bar_check_item" ("check_id","added_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_check_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"check_id" text NOT NULL REFERENCES "bar_check"("id") ON DELETE cascade,
	"tender" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"cash_tendered_cents" integer,
	"change_cents" integer,
	"provider_payment_id" text,
	"taken_by_id" text REFERENCES "user"("id") ON DELETE set null,
	"taken_by_name" text,
	"taken_at" timestamp DEFAULT now() NOT NULL,
	"voided_at" timestamp,
	"void_reason" text,
	"voided_by_name" text,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_check_payment_check_idx" ON "bar_check_payment" ("check_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_check_payment_company_taken_idx" ON "bar_check_payment" ("company_id","taken_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_kitchen_ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"check_id" text REFERENCES "bar_check"("id") ON DELETE set null,
	"fired_at" timestamp DEFAULT now() NOT NULL,
	"fired_by_name" text,
	"bumped_at" timestamp,
	"bumped_by_name" text,
	"recalled_at" timestamp,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_kitchen_ticket_company_open_idx" ON "bar_kitchen_ticket" ("company_id","bumped_at","fired_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_kitchen_ticket_item" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL REFERENCES "bar_kitchen_ticket"("id") ON DELETE cascade,
	"menu_item_id" text REFERENCES "bar_menu_item"("id") ON DELETE set null,
	"name" text NOT NULL,
	"variation" text,
	"qty" integer DEFAULT 1 NOT NULL,
	"note" text,
	"seat" integer,
	"prep_seconds" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_kitchen_ticket_item_ticket_idx" ON "bar_kitchen_ticket_item" ("ticket_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_closeout" (
	"id" text PRIMARY KEY NOT NULL,
	"business_day" text NOT NULL,
	"cash_expected_cents" integer NOT NULL,
	"cash_counted_cents" integer,
	"float_cents" integer DEFAULT 0 NOT NULL,
	"over_short_cents" integer,
	"note" text,
	"summary" json NOT NULL,
	"closed_by_id" text REFERENCES "user"("id") ON DELETE set null,
	"closed_by_name" text,
	"closed_at" timestamp DEFAULT now() NOT NULL,
	"emailed_at" timestamp,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_closeout_company_day_idx" ON "bar_closeout" ("company_id","business_day");
