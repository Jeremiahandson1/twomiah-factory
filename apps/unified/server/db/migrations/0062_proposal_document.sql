CREATE TABLE IF NOT EXISTS "quote_proposal_document" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"quote_id" text NOT NULL,
	"cover_title" text,
	"cover_subtitle" text,
	"cover_photo" text,
	"about_us" text,
	"sections" json,
	"terms_clauses" json,
	"attachments" json,
	"cosigner_name" text,
	"cosigner_email" text,
	"cosigner_role" text,
	"cosigner_token" text,
	"cosigner_requested_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quote_proposal_document_quote_id_unique" UNIQUE("quote_id"),
	CONSTRAINT "quote_proposal_document_cosigner_token_unique" UNIQUE("cosigner_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_proposal_mark" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"quote_id" text NOT NULL,
	"kind" text NOT NULL,
	"clause_id" text,
	"name" text,
	"initials" text,
	"signature" text,
	"document_hash" text,
	"signed_ip" text,
	"signed_user_agent" text,
	"signed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_proposal_option" ADD COLUMN "attachments" json;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote_proposal_document" ADD CONSTRAINT "quote_proposal_document_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote_proposal_document" ADD CONSTRAINT "quote_proposal_document_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote_proposal_mark" ADD CONSTRAINT "quote_proposal_mark_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote_proposal_mark" ADD CONSTRAINT "quote_proposal_mark_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_proposal_mark_quote_id_idx" ON "quote_proposal_mark" USING btree ("quote_id");