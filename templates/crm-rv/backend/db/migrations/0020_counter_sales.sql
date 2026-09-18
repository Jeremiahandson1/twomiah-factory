-- Phase 1 DMS wiring: walk-in parts counter (POS). Lines decrement the same
-- perpetual stock ledger as repair-order parts.

CREATE TABLE IF NOT EXISTS "counter_sale" (
	"id" text PRIMARY KEY NOT NULL,
	"sale_number" text,
	"status" text DEFAULT 'open' NOT NULL,
	"subtotal" numeric(10, 2) DEFAULT '0' NOT NULL,
	"tax" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total" numeric(10, 2) DEFAULT '0' NOT NULL,
	"payment_method" text,
	"notes" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"customer_id" text,
	"created_by_id" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "counter_sale_line" (
	"id" text PRIMARY KEY NOT NULL,
	"counter_sale_id" text NOT NULL,
	"item_id" text,
	"catalog_part_id" text,
	"location_id" text,
	"part_number" text,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_cost" numeric(10, 2) DEFAULT '0' NOT NULL,
	"unit_price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total_price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"stock_decremented" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "counter_sale" ADD CONSTRAINT "counter_sale_customer_id_contact_id_fk" FOREIGN KEY ("customer_id") REFERENCES "contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "counter_sale" ADD CONSTRAINT "counter_sale_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "counter_sale" ADD CONSTRAINT "counter_sale_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "counter_sale_line" ADD CONSTRAINT "counter_sale_line_counter_sale_id_counter_sale_id_fk" FOREIGN KEY ("counter_sale_id") REFERENCES "counter_sale"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "counter_sale_line" ADD CONSTRAINT "counter_sale_line_item_id_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory_item"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "counter_sale_line" ADD CONSTRAINT "counter_sale_line_catalog_part_id_catalog_part_id_fk" FOREIGN KEY ("catalog_part_id") REFERENCES "catalog_part"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "counter_sale_line" ADD CONSTRAINT "counter_sale_line_location_id_inventory_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "inventory_location"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "counter_sale_line" ADD CONSTRAINT "counter_sale_line_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "counter_sale_company_idx" ON "counter_sale" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "counter_sale_status_idx" ON "counter_sale" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "counter_sale_number_company_key" ON "counter_sale" ("sale_number","company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "counter_sale_line_sale_idx" ON "counter_sale_line" ("counter_sale_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "counter_sale_line_company_idx" ON "counter_sale_line" ("company_id");
