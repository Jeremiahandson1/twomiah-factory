CREATE TABLE IF NOT EXISTS "salon_reader" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"stripe_reader_id" text NOT NULL,
	"stripe_account" text NOT NULL,
	"location_id" text NOT NULL,
	"label" text NOT NULL,
	"device_type" text,
	"serial_number" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_retail_product" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"sku" text,
	"price_cents" integer NOT NULL,
	"cost_cents" integer,
	"reorder_at" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_retail_sale" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"product_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"line_item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_stock_move" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"by_name" text,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_terminal_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"reader_id" text NOT NULL,
	"stripe_account" text NOT NULL,
	"payment_intent_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure" text,
	"payment_id" text,
	"started_by_id" text,
	"started_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_reader" ADD CONSTRAINT "salon_reader_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_retail_product" ADD CONSTRAINT "salon_retail_product_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_retail_sale" ADD CONSTRAINT "salon_retail_sale_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_retail_sale" ADD CONSTRAINT "salon_retail_sale_product_id_salon_retail_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."salon_retail_product"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_retail_sale" ADD CONSTRAINT "salon_retail_sale_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_retail_sale" ADD CONSTRAINT "salon_retail_sale_line_item_id_invoice_line_item_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."invoice_line_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_stock_move" ADD CONSTRAINT "salon_stock_move_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_stock_move" ADD CONSTRAINT "salon_stock_move_product_id_salon_retail_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."salon_retail_product"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_terminal_charge" ADD CONSTRAINT "salon_terminal_charge_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_terminal_charge" ADD CONSTRAINT "salon_terminal_charge_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_terminal_charge" ADD CONSTRAINT "salon_terminal_charge_reader_id_salon_reader_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."salon_reader"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_reader_company_reader_key" ON "salon_reader" USING btree ("company_id","stripe_reader_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_retail_product_company_idx" ON "salon_retail_product" USING btree ("company_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_retail_sale_line_key" ON "salon_retail_sale" USING btree ("line_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_retail_sale_product_idx" ON "salon_retail_sale" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_retail_sale_invoice_idx" ON "salon_retail_sale" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_stock_move_product_idx" ON "salon_stock_move" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_terminal_charge_pi_key" ON "salon_terminal_charge" USING btree ("company_id","payment_intent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_terminal_charge_invoice_idx" ON "salon_terminal_charge" USING btree ("invoice_id");