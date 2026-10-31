-- Good / Better / Best, finished (docs/parity/fieldservice-quote-options.md rows 5 and 6): a quote's options sit in SETS.
-- set_index orders up to three sets; set_name is what the customer sees above a set; set_kind is 'one' (pick exactly one)
-- or 'any' (additive: any combination). Every option a quote already has is its only set, index 0, pick one — as before.
ALTER TABLE "quote_proposal_option" ADD COLUMN "set_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_proposal_option" ADD COLUMN "set_name" text;--> statement-breakpoint
ALTER TABLE "quote_proposal_option" ADD COLUMN "set_kind" text DEFAULT 'one' NOT NULL;
