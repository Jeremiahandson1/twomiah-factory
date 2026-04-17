-- Per-invoice payment records.
-- Distinct from the existing `payments` table which tracks payer-level check
-- receipts reconciled against claims. `invoice_payments` records a single
-- payment event against a single invoice.

CREATE TABLE IF NOT EXISTS "invoice_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_method" text DEFAULT 'check' NOT NULL,
	"reference_number" text,
	"payment_date" date,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_payments_invoice_id_idx" ON "invoice_payments" ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_payments_payment_date_idx" ON "invoice_payments" ("payment_date");
