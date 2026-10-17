-- Stock and costing (services/barStock.ts): vendors, stock items bought by the pack and used by the unit, recipes,
-- counts, purchase orders; the keg and pour on a tap; the pour's snapshot on a check line; the PO counter.
ALTER TABLE "bar_settings" ADD COLUMN IF NOT EXISTS "po_seq" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_vendor" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"order_days" text,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_vendor_company_idx" ON "bar_vendor" ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_stock_item" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'food' NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"pack_name" text DEFAULT 'each' NOT NULL,
	"pack_size" numeric(12, 3) DEFAULT '1' NOT NULL,
	"pack_cost_cents" integer,
	"vendor_id" text REFERENCES "bar_vendor"("id") ON DELETE set null,
	"par_packs" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_stock_item_company_idx" ON "bar_stock_item" ("company_id","category");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_recipe_line" (
	"id" text PRIMARY KEY NOT NULL,
	"menu_item_id" text NOT NULL REFERENCES "bar_menu_item"("id") ON DELETE cascade,
	"size_id" text,
	"stock_item_id" text NOT NULL REFERENCES "bar_stock_item"("id") ON DELETE cascade,
	"qty" numeric(10, 3) NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_recipe_line_item_idx" ON "bar_recipe_line" ("menu_item_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_stock_count" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"started_by_name" text,
	"finished_at" timestamp,
	"finished_by_name" text,
	"note" text,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_stock_count_company_idx" ON "bar_stock_count" ("company_id","status","finished_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_stock_count_line" (
	"id" text PRIMARY KEY NOT NULL,
	"count_id" text NOT NULL REFERENCES "bar_stock_count"("id") ON DELETE cascade,
	"stock_item_id" text NOT NULL REFERENCES "bar_stock_item"("id") ON DELETE cascade,
	"qty" numeric(12, 3) NOT NULL,
	"counted_by_name" text,
	"counted_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_stock_count_line_key" ON "bar_stock_count_line" ("count_id","stock_item_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_purchase_order" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"vendor_id" text REFERENCES "bar_vendor"("id") ON DELETE set null,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by_name" text,
	"sent_at" timestamp,
	"received_at" timestamp,
	"received_by_name" text,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_purchase_order_company_number_key" ON "bar_purchase_order" ("company_id","number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_purchase_order_line" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL REFERENCES "bar_purchase_order"("id") ON DELETE cascade,
	"stock_item_id" text NOT NULL REFERENCES "bar_stock_item"("id") ON DELETE cascade,
	"packs" numeric(10, 2) NOT NULL,
	"pack_cost_cents" integer,
	"received_packs" numeric(10, 2),
	"received_cost_cents" integer,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_purchase_order_line_order_idx" ON "bar_purchase_order_line" ("order_id");
--> statement-breakpoint
ALTER TABLE "bar_tap" ADD COLUMN IF NOT EXISTS "stock_item_id" text REFERENCES "bar_stock_item"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "bar_tap" ADD COLUMN IF NOT EXISTS "pour_oz" numeric(6, 2) DEFAULT '16' NOT NULL;
--> statement-breakpoint
ALTER TABLE "bar_check_item" ADD COLUMN IF NOT EXISTS "stock_item_id" text;
--> statement-breakpoint
ALTER TABLE "bar_check_item" ADD COLUMN IF NOT EXISTS "stock_qty" numeric(10, 3);
