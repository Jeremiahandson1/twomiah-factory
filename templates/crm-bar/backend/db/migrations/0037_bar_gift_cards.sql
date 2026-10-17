-- The bar's own gift cards (services/barGiftCards.ts): the card, its ledger, the code prefix on bar_settings, and
-- on the register the card a payment came off and the card a gift-card line issued.
ALTER TABLE "bar_settings" ADD COLUMN IF NOT EXISTS "gift_card_prefix" text;
--> statement-breakpoint
ALTER TABLE "bar_check_item" ADD COLUMN IF NOT EXISTS "gift_card_id" text;
--> statement-breakpoint
ALTER TABLE "bar_check_payment" ADD COLUMN IF NOT EXISTS "gift_card_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_gift_card" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"initial_cents" integer NOT NULL,
	"balance_cents" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sold_via" text NOT NULL,
	"sold_by_name" text,
	"check_id" text REFERENCES "bar_check"("id") ON DELETE set null,
	"purchaser_name" text,
	"purchaser_email" text,
	"recipient_name" text,
	"recipient_email" text,
	"message" text,
	"provider_payment_id" text,
	"idempotency_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"voided_at" timestamp,
	"void_reason" text,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_gift_card_company_code_key" ON "bar_gift_card" ("company_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_gift_card_company_key_key" ON "bar_gift_card" ("company_id","idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_gift_card_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL REFERENCES "bar_gift_card"("id") ON DELETE cascade,
	"amount_cents" integer NOT NULL,
	"kind" text NOT NULL,
	"check_id" text,
	"payment_id" text,
	"by_name" text,
	"note" text,
	"at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_gift_card_ledger_card_idx" ON "bar_gift_card_ledger" ("card_id","at");
