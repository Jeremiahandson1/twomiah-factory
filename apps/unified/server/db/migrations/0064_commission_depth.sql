CREATE TABLE IF NOT EXISTS "salon_sale_seller" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"payee_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commission" ADD COLUMN "units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commission" ADD COLUMN "original_base" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "commission" ADD COLUMN "original_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "commission" ADD COLUMN "refunded_ratio" numeric(6, 5) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_plan" ADD COLUMN "tier_basis" text DEFAULT 'sales' NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_plan" ADD COLUMN "tier_cadence" text DEFAULT 'month' NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_plan" ADD COLUMN "scope" json DEFAULT '{}'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_enrollment" ADD COLUMN "sold_by" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_sale_seller" ADD CONSTRAINT "salon_sale_seller_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_sale_seller" ADD CONSTRAINT "salon_sale_seller_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_sale_seller_invoice_key" ON "salon_sale_seller" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_sale_seller_company_idx" ON "salon_sale_seller" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commission_refund_once" ON "commission" USING btree ("reversal_of","refunded_ratio") WHERE source = 'refund';