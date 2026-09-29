CREATE TABLE IF NOT EXISTS "client_account_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"invoice_id" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_account_entry" ADD CONSTRAINT "client_account_entry_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_account_entry" ADD CONSTRAINT "client_account_entry_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_account_entry" ADD CONSTRAINT "client_account_entry_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_account_entry" ADD CONSTRAINT "client_account_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_account_entry_client_idx" ON "client_account_entry" ("company_id","contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_account_entry_invoice_idx" ON "client_account_entry" ("invoice_id");
