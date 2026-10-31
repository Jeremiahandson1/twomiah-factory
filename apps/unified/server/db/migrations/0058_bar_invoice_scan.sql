CREATE TABLE IF NOT EXISTS "bar_invoice_scan" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'review' NOT NULL,
	"vendor_id" text,
	"supplier_name" text,
	"invoice_number" text,
	"invoice_date" text,
	"total_cents" integer,
	"lines" json DEFAULT '[]'::json NOT NULL,
	"notes" text,
	"file_key" text,
	"file_type" text,
	"file_name" text,
	"reader" text,
	"order_id" text,
	"created_by_name" text,
	"confirmed_by_name" text,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_invoice_scan" ADD CONSTRAINT "bar_invoice_scan_vendor_id_bar_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."bar_vendor"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_invoice_scan" ADD CONSTRAINT "bar_invoice_scan_order_id_bar_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bar_purchase_order"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_invoice_scan" ADD CONSTRAINT "bar_invoice_scan_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_invoice_scan_company_idx" ON "bar_invoice_scan" USING btree ("company_id","created_at");