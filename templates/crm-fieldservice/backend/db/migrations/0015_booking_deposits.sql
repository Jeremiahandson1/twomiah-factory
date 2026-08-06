ALTER TABLE "online_booking" ADD COLUMN IF NOT EXISTS "confirmation_code" text;--> statement-breakpoint
ALTER TABLE "online_booking" ADD COLUMN IF NOT EXISTS "deposit_amount" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "online_booking" ADD COLUMN IF NOT EXISTS "deposit_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "online_booking" ADD COLUMN IF NOT EXISTS "payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "online_booking" ADD COLUMN IF NOT EXISTS "deposit_paid_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "online_booking_confirmation_code_idx" ON "online_booking" ("confirmation_code");
