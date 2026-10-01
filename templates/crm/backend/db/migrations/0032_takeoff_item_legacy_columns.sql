-- Adding an item to a takeoff sheet could never work on a fresh database. (found fixing T32 L8/M4)
--
-- `takeoff_item` was created in 0000 for a DIFFERENT, older takeoff model — a flat list of priced
-- lines belonging to a `takeoff` row:
--
--     name, description, quantity, unit, unit_cost, total_cost, category, takeoff_id, sheet_id
--
-- …with `unit` and `takeoff_id` NOT NULL and no defaults. Migration 0013 then bolted the CURRENT
-- model's columns on beside them (assembly_id, location, measurement_type, length, width, height,
-- measurement_value, waste_factor, sort_order, company_id) and left the old NOT NULLs in place.
--
-- services/takeoffs.ts writes the new shape and names neither `unit` nor `takeoff_id`. So
-- POST /api/takeoffs/sheets/:id/items violated NOT NULL and answered 400 "A required field is
-- missing." — on every tenant, since the module shipped. The measuring tool could not measure
-- anything.
--
-- Nothing caught it because nothing ever called it: the T32 round created a sheet and two
-- assemblies and never added an item, and the suite had no takeoff test. The same shape as the four
-- pay runs that 500'd for months (no screen → no caller → no test). The test that goes with this
-- migration adds an item, which is why it surfaced at all.
--
-- The legacy columns are NOT dropped. A tenant may hold old rows that use them, and dropping a
-- column to make an INSERT work is how data goes missing. They are made optional, which is what
-- they actually are now.
ALTER TABLE "takeoff_item" ALTER COLUMN "unit" DROP NOT NULL;
ALTER TABLE "takeoff_item" ALTER COLUMN "takeoff_id" DROP NOT NULL;

-- `quantity` IS written by the service, but with no default a future caller that omits it hits the
-- same wall. 1 is the sensible count for one measured line.
ALTER TABLE "takeoff_item" ALTER COLUMN "quantity" SET DEFAULT 1;

-- The calculated-material rows the service writes alongside: `unit_price`, `total_price` and
-- `inventory_item_id` are in its INSERT and in no migration, so the same failure sat one table
-- further in. 0013 re-created this table but only in the form 0000 already had.
ALTER TABLE "takeoff_calculated_material" ADD COLUMN IF NOT EXISTS "unit_price" numeric(12, 2) DEFAULT 0;
ALTER TABLE "takeoff_calculated_material" ADD COLUMN IF NOT EXISTS "total_price" numeric(12, 2) DEFAULT 0;
ALTER TABLE "takeoff_calculated_material" ADD COLUMN IF NOT EXISTS "inventory_item_id" text;

-- …and on the assembly's own materials, which createAssembly writes.
ALTER TABLE "assembly_material" ADD COLUMN IF NOT EXISTS "unit_price" numeric(12, 2) DEFAULT 0;
ALTER TABLE "assembly_material" ADD COLUMN IF NOT EXISTS "inventory_item_id" text;

-- AND THE FOREIGN KEY POINTED AT THE WRONG TABLE ENTIRELY.
--
--     ALTER TABLE "takeoff_calculated_material"
--       ADD CONSTRAINT "takeoff_calculated_material_item_id_project_task_id_fk"
--       FOREIGN KEY ("item_id") REFERENCES "public"."project_task"("id")
--
-- `item_id` holds a TAKEOFF ITEM id and the constraint required a PROJECT TASK id — a generated
-- migration resolving `item` to the wrong table. So even with the NOT NULLs above relaxed, the
-- calculation's INSERT answered 409 "A related record does not exist, or is still in use." The
-- takeoff tool could not store a single calculated material, on any tenant, ever.
--
-- Two defects stacked on one code path is exactly what "no screen → no caller → no test" produces:
-- nothing had ever run it, so nothing had ever hit either.
DO $$ BEGIN
  ALTER TABLE "takeoff_calculated_material" DROP CONSTRAINT "takeoff_calculated_material_item_id_project_task_id_fk";
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "takeoff_calculated_material"
    ADD CONSTRAINT "takeoff_calculated_material_item_id_takeoff_item_id_fk"
    FOREIGN KEY ("item_id") REFERENCES "takeoff_item"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
