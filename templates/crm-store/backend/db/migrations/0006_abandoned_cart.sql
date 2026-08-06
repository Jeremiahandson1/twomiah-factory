ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "recovery_token" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "abandoned_email_sent_at" timestamptz;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "recovered_at" timestamptz;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_recovery_token_unique" ON "orders" ("recovery_token");--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "abandoned_cart_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "abandoned_cart_delay_minutes" integer DEFAULT 60 NOT NULL;
