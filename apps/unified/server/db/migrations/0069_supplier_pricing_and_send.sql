CREATE TABLE IF NOT EXISTS "supplier_price_item" (
	"id" text PRIMARY KEY NOT NULL,
	"price_list_id" text NOT NULL,
	"code" text,
	"sku" text,
	"description" text NOT NULL,
	"unit" text DEFAULT 'ea' NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_price_list" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"supplier" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "price_list_id" text;--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "send_log" json;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplier_price_item" ADD CONSTRAINT "supplier_price_item_price_list_id_supplier_price_list_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."supplier_price_list"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplier_price_list" ADD CONSTRAINT "supplier_price_list_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_price_item_price_list_id_idx" ON "supplier_price_item" USING btree ("price_list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_price_list_company_id_idx" ON "supplier_price_list" USING btree ("company_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material" ADD CONSTRAINT "material_price_list_id_supplier_price_list_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."supplier_price_list"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
