CREATE TABLE IF NOT EXISTS "quote_proposal_option" (
	"id" text PRIMARY KEY NOT NULL,
	"quote_id" text NOT NULL,
	"name" text NOT NULL,
	"tier" text,
	"brand" text,
	"warranty" text,
	"description" text,
	"photos" json,
	"recommended" boolean DEFAULT false NOT NULL,
	"chosen" boolean DEFAULT false NOT NULL,
	"chosen_at" timestamp,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "proposal_option_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote_proposal_option" ADD CONSTRAINT "quote_proposal_option_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_proposal_option_quote_id_idx" ON "quote_proposal_option" USING btree ("quote_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote_line_item" ADD CONSTRAINT "quote_line_item_proposal_option_id_quote_proposal_option_id_fk" FOREIGN KEY ("proposal_option_id") REFERENCES "public"."quote_proposal_option"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_line_item_proposal_option_id_idx" ON "quote_line_item" USING btree ("proposal_option_id");