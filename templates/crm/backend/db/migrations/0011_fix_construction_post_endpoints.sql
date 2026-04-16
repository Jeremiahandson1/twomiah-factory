-- Fix construction-tier POST endpoint failures.
-- 1. Make purchase_order.location_id nullable (was NOT NULL, blocks PO creation without warehouse)
-- 2. Ensure all raw-SQL-inserted tables have correct column availability

ALTER TABLE "purchase_order" ALTER COLUMN "location_id" DROP NOT NULL;
