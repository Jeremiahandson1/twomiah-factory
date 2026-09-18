-- Phase 1 DMS wiring: link stocked items to the OEM catalog, and add real
-- repair-order parts lines that move the perpetual stock ledger.

-- 1. Unify catalog <-> stock: a stocked inventory_item can point at its catalog_part.
ALTER TABLE "inventory_item" ADD COLUMN IF NOT EXISTS "catalog_part_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_catalog_part_id_catalog_part_id_fk" FOREIGN KEY ("catalog_part_id") REFERENCES "catalog_part"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_item_catalog_part_idx" ON "inventory_item" ("catalog_part_id");
--> statement-breakpoint

-- 2. Repair-order parts lines (decrement stock on add, restock on remove).
CREATE TABLE IF NOT EXISTS "repair_order_part" (
	"id" text PRIMARY KEY NOT NULL,
	"repair_order_id" text NOT NULL,
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
 ALTER TABLE "repair_order_part" ADD CONSTRAINT "repair_order_part_repair_order_id_repair_order_id_fk" FOREIGN KEY ("repair_order_id") REFERENCES "repair_order"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order_part" ADD CONSTRAINT "repair_order_part_item_id_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory_item"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order_part" ADD CONSTRAINT "repair_order_part_catalog_part_id_catalog_part_id_fk" FOREIGN KEY ("catalog_part_id") REFERENCES "catalog_part"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order_part" ADD CONSTRAINT "repair_order_part_location_id_inventory_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "inventory_location"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order_part" ADD CONSTRAINT "repair_order_part_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_order_part_ro_idx" ON "repair_order_part" ("repair_order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_order_part_company_idx" ON "repair_order_part" ("company_id");
