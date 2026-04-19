-- Add columns that exist in schema.ts / service code but are missing from
-- the initial migration (0000). These cause runtime 500 errors.

-- SELECTION_CATEGORY: missing icon, description, default_allowance
ALTER TABLE "selection_category" ADD COLUMN IF NOT EXISTS "icon" text;
ALTER TABLE "selection_category" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "selection_category" ADD COLUMN IF NOT EXISTS "default_allowance" numeric(12, 2) DEFAULT 0;

-- TAKEOFF_ITEM: migration 0000 has a simpler schema than what the service uses.
-- Add the columns the takeoffs service INSERT references.
ALTER TABLE "takeoff_item" ADD COLUMN IF NOT EXISTS "assembly_id" text;
ALTER TABLE "takeoff_item" ADD COLUMN IF NOT EXISTS "location" text;
ALTER TABLE "takeoff_item" ADD COLUMN IF NOT EXISTS "measurement_type" text DEFAULT 'area';
ALTER TABLE "takeoff_item" ADD COLUMN IF NOT EXISTS "length" numeric(12, 4) DEFAULT 0;
ALTER TABLE "takeoff_item" ADD COLUMN IF NOT EXISTS "width" numeric(12, 4) DEFAULT 0;
ALTER TABLE "takeoff_item" ADD COLUMN IF NOT EXISTS "height" numeric(12, 4) DEFAULT 0;
ALTER TABLE "takeoff_item" ADD COLUMN IF NOT EXISTS "measurement_value" numeric(12, 4) DEFAULT 0;
ALTER TABLE "takeoff_item" ADD COLUMN IF NOT EXISTS "waste_factor" numeric(5, 2) DEFAULT 10;
ALTER TABLE "takeoff_item" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE "takeoff_item" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0;
ALTER TABLE "takeoff_item" ADD COLUMN IF NOT EXISTS "company_id" text;

-- TAKEOFF_CALCULATED_MATERIAL: may not exist at all in some DBs
CREATE TABLE IF NOT EXISTS "takeoff_calculated_material" (
  "id" text PRIMARY KEY NOT NULL,
  "item_id" text NOT NULL,
  "material_name" text NOT NULL,
  "unit" text,
  "base_quantity" numeric(12, 4) DEFAULT 0,
  "waste_quantity" numeric(12, 4) DEFAULT 0,
  "total_quantity" numeric(12, 4) DEFAULT 0,
  "unit_cost" numeric(12, 2) DEFAULT 0,
  "unit_price" numeric(12, 2) DEFAULT 0,
  "total_cost" numeric(12, 2) DEFAULT 0,
  "total_price" numeric(12, 2) DEFAULT 0,
  "inventory_item_id" text
);
