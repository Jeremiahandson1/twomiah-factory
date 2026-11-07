ALTER TABLE "project" ADD COLUMN "parameters" json;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "parameters" json;--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "formula_key" text;--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "quantity_formula" text;--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "price_formula" text;--> statement-breakpoint
ALTER TABLE "pricebook_item" ADD COLUMN "quantity_formula" text;