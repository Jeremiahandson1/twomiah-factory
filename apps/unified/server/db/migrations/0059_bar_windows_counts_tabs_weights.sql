ALTER TABLE "bar_terminal_charge" ALTER COLUMN "reader_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bar_menu_item" ADD COLUMN "stock_count" integer;--> statement-breakpoint
ALTER TABLE "bar_menu_item" ADD COLUMN "stock_count_reset" integer;--> statement-breakpoint
ALTER TABLE "bar_menu_item" ADD COLUMN "stock_counted_at" timestamp;--> statement-breakpoint
ALTER TABLE "bar_menu_section" ADD COLUMN "available_windows" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "bar_stock_item" ADD COLUMN "bottle_tare_grams" integer;--> statement-breakpoint
ALTER TABLE "bar_stock_item" ADD COLUMN "bottle_full_grams" integer;