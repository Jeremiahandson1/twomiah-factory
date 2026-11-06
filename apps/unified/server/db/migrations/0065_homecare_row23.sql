CREATE TABLE IF NOT EXISTS "care_books" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"refs" json DEFAULT '{}'::json NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "care_books_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "care_qb_removal" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"qb_id" text NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_contact_kind" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_family_member_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_contact_name" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_emails" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "qb_customer_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "qb_hash" text;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "qb_payment_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "qb_invoice_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "qb_hash" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "qb_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "referral_sources" ADD COLUMN "qb_customer_id" text;--> statement-breakpoint
ALTER TABLE "referral_sources" ADD COLUMN "qb_hash" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_books" ADD CONSTRAINT "care_books_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_qb_removal" ADD CONSTRAINT "care_qb_removal_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_qb_removal_company_idx" ON "care_qb_removal" USING btree ("company_id");