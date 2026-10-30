ALTER TABLE "bar_menu_item" ADD COLUMN "eighty_six_until_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bar_menu_item" ADD COLUMN "eighty_sixed_at" timestamp;--> statement-breakpoint
ALTER TABLE "bar_menu_section" ADD COLUMN "available_from" text;--> statement-breakpoint
ALTER TABLE "bar_menu_section" ADD COLUMN "available_to" text;--> statement-breakpoint
ALTER TABLE "bar_menu_section" ADD COLUMN "available_days" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "bar_stock_count_line" ADD COLUMN "fills" json;