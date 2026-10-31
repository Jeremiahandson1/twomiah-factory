CREATE TABLE IF NOT EXISTS "client_billing_splits" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"payer_id" text NOT NULL,
	"priority" integer NOT NULL,
	"kind" text NOT NULL,
	"value" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "bill_to" text DEFAULT 'family' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "split_group_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "counts_hours" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_billing_splits" ADD CONSTRAINT "client_billing_splits_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_billing_splits" ADD CONSTRAINT "client_billing_splits_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_billing_splits" ADD CONSTRAINT "client_billing_splits_payer_id_referral_sources_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."referral_sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_billing_splits_client_idx" ON "client_billing_splits" USING btree ("company_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_billing_splits_client_payer_unique" ON "client_billing_splits" USING btree ("client_id","payer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_split_group_idx" ON "invoices" USING btree ("split_group_id");--> statement-breakpoint
-- Who an existing invoice is billed to: one written for a payer (an insurance invoice naming its referral source) is the
-- payer's; every other is the family's. The family portal, the public pay page and the family's saved card take only theirs.
UPDATE "invoices" SET "bill_to" = 'payer' WHERE "invoice_type" = 'insurance' AND "referral_source_id" IS NOT NULL;
