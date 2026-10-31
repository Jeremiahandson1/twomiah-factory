CREATE TABLE IF NOT EXISTS "store_purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"supplier_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"expected_on" text,
	"sent_at" timestamp,
	"sent_to" text,
	"received_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_purchase_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_order_id" text NOT NULL,
	"variant_id" text,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_cents" integer DEFAULT 0 NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "supplier_id" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "reorder_to_qty" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_purchase_orders" ADD CONSTRAINT "store_purchase_orders_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_purchase_orders" ADD CONSTRAINT "store_purchase_orders_supplier_id_store_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."store_suppliers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_purchase_order_lines" ADD CONSTRAINT "store_purchase_order_lines_purchase_order_id_store_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."store_purchase_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_purchase_order_lines" ADD CONSTRAINT "store_purchase_order_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_suppliers" ADD CONSTRAINT "store_suppliers_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_purchase_orders_company_number_unique" ON "store_purchase_orders" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_purchase_orders_company_status_idx" ON "store_purchase_orders" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_purchase_order_lines_po_idx" ON "store_purchase_order_lines" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_suppliers_company_name_unique" ON "store_suppliers" USING btree ("company_id","name");