ALTER TABLE "commission" ADD COLUMN "earn_key" text;--> statement-breakpoint
ALTER TABLE "commission_plan" ADD COLUMN "trigger_on" text DEFAULT 'collected' NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_plan" ADD COLUMN "zero_balance_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commission_earn_key_once" ON "commission" USING btree ("earn_key") WHERE earn_key IS NOT NULL;