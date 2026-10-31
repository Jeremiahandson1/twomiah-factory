ALTER TABLE "quote" ADD COLUMN "option_discount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "option_role" text;--> statement-breakpoint
ALTER TABLE "quote_proposal_option" ADD COLUMN "discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_proposal_option" ADD COLUMN "discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL;