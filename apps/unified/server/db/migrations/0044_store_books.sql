CREATE TABLE IF NOT EXISTS "store_books" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"bank_account_id" text,
	"bank_account_name" text,
	"refs" json DEFAULT '{}'::json NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"provider_payout_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"arrived_at" timestamp NOT NULL,
	"lines" json DEFAULT '[]'::json NOT NULL,
	"qb_deposit_id" text,
	"qb_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qb_sync_run" ADD COLUMN "orders" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "qb_sync_run" ADD COLUMN "refunds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "qb_sync_run" ADD COLUMN "payouts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "qb_sales_receipt_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "qb_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "order_refunds" ADD COLUMN "qb_refund_receipt_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_books" ADD CONSTRAINT "store_books_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_payouts" ADD CONSTRAINT "store_payouts_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_books_company_unique" ON "store_books" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_payouts_company_payout_unique" ON "store_payouts" USING btree ("company_id","provider_payout_id");