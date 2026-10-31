ALTER TABLE "bar_menu_item" ADD COLUMN "stock_count" integer;--> statement-breakpoint
ALTER TABLE "bar_menu_item" ADD COLUMN "stock_count_reset" integer;--> statement-breakpoint
ALTER TABLE "bar_menu_item" ADD COLUMN "stock_counted_at" timestamp;