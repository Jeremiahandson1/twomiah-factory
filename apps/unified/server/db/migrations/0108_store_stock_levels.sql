CREATE TABLE IF NOT EXISTS "store_stock_level" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_stock_level" ADD CONSTRAINT "store_stock_level_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_stock_level" ADD CONSTRAINT "store_stock_level_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_stock_level" ADD CONSTRAINT "store_stock_level_location_id_inventory_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_location"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_stock_level_variant_location_unique" ON "store_stock_level" USING btree ("variant_id","location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_stock_level_company_idx" ON "store_stock_level" USING btree ("company_id");