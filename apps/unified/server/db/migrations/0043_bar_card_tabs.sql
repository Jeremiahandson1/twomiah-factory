ALTER TABLE "bar_terminal_charge" ADD COLUMN "kind" text DEFAULT 'sale' NOT NULL;--> statement-breakpoint
ALTER TABLE "bar_terminal_charge" ADD COLUMN "capture_before" timestamp;--> statement-breakpoint
ALTER TABLE "bar_terminal_charge" ADD COLUMN "card_brand" text;--> statement-breakpoint
ALTER TABLE "bar_terminal_charge" ADD COLUMN "card_last4" text;--> statement-breakpoint
ALTER TABLE "bar_terminal_charge" ADD COLUMN "cardholder" text;