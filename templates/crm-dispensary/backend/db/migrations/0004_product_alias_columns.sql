-- Add missing product columns referenced by routes and schema
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sale_price" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "in_stock" BOOLEAN DEFAULT true;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "total_sold" INTEGER DEFAULT 0;
