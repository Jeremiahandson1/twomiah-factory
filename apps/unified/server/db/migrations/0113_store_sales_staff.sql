ALTER TABLE "orders" ADD COLUMN "staff_user_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "staff_name" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "staff_user_id" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "staff_name" text;