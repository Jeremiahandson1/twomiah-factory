ALTER TABLE "product_variants" ADD COLUMN "low_stock_at" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "low_stock_alerted_at" timestamp;