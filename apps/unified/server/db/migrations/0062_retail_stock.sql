CREATE TABLE IF NOT EXISTS "salon_purchase_order" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"location_id" text,
	"note" text,
	"sent_at" timestamp,
	"sent_to" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_purchase_order_line" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"purchase_order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"received" integer DEFAULT 0 NOT NULL,
	"unit_cost_cents" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_stock_location" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_supplier" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon_retail_product" ADD COLUMN "reorder_qty" integer;--> statement-breakpoint
ALTER TABLE "salon_retail_product" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "salon_retail_product" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "salon_retail_product" ADD COLUMN "supplier_id" text;--> statement-breakpoint
ALTER TABLE "salon_retail_sale" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "salon_retail_sale" ADD COLUMN "stylist_id" text;--> statement-breakpoint
ALTER TABLE "salon_retail_sale" ADD COLUMN "stylist_member_id" text;--> statement-breakpoint
ALTER TABLE "salon_stock_move" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "salon_stock_move" ADD COLUMN "transfer_id" text;--> statement-breakpoint
ALTER TABLE "salon_stock_move" ADD COLUMN "purchase_order_id" text;--> statement-breakpoint
ALTER TABLE "salon_stock_move" ADD COLUMN "invoice_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_purchase_order" ADD CONSTRAINT "salon_purchase_order_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_purchase_order" ADD CONSTRAINT "salon_purchase_order_supplier_id_salon_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."salon_supplier"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_purchase_order_line" ADD CONSTRAINT "salon_purchase_order_line_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_purchase_order_line" ADD CONSTRAINT "salon_purchase_order_line_purchase_order_id_salon_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."salon_purchase_order"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_purchase_order_line" ADD CONSTRAINT "salon_purchase_order_line_product_id_salon_retail_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."salon_retail_product"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_stock_location" ADD CONSTRAINT "salon_stock_location_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_supplier" ADD CONSTRAINT "salon_supplier_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_purchase_order_number_key" ON "salon_purchase_order" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_purchase_order_supplier_idx" ON "salon_purchase_order" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_purchase_order_line_key" ON "salon_purchase_order_line" USING btree ("purchase_order_id","product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_stock_location_company_idx" ON "salon_stock_location" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_supplier_company_idx" ON "salon_supplier" USING btree ("company_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_retail_product" ADD CONSTRAINT "salon_retail_product_supplier_id_salon_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."salon_supplier"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_retail_product_barcode_key" ON "salon_retail_product" USING btree ("company_id","barcode");