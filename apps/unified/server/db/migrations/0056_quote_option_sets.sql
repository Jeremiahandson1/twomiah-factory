ALTER TABLE "quote_proposal_option" ADD COLUMN "set_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_proposal_option" ADD COLUMN "set_name" text;--> statement-breakpoint
ALTER TABLE "quote_proposal_option" ADD COLUMN "set_kind" text DEFAULT 'one' NOT NULL;