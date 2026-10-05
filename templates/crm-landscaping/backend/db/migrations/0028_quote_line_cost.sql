ALTER TABLE "quote_line_item" ADD COLUMN IF NOT EXISTS "unit_cost" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN IF NOT EXISTS "pricebook_item_id" text;
