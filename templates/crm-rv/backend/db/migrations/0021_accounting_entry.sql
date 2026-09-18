-- Phase 2: native general-ledger journal. Every sale/RO posts revenue + COGS +
-- gross profit here — the book of record for P&L and department gross.

CREATE TABLE IF NOT EXISTS "accounting_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_date" timestamp DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"ref" text,
	"description" text,
	"revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax" numeric(12, 2) DEFAULT '0' NOT NULL,
	"gross_profit" numeric(12, 2) DEFAULT '0' NOT NULL,
	"posted_to_qb" boolean DEFAULT false NOT NULL,
	"qb_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"customer_id" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_entry" ADD CONSTRAINT "accounting_entry_customer_id_contact_id_fk" FOREIGN KEY ("customer_id") REFERENCES "contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_entry" ADD CONSTRAINT "accounting_entry_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounting_entry_company_idx" ON "accounting_entry" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounting_entry_category_idx" ON "accounting_entry" ("category");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_entry_source_key" ON "accounting_entry" ("company_id","source_type","source_id");
