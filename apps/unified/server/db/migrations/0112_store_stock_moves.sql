CREATE TABLE IF NOT EXISTS "store_stock_moves" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"reason" text NOT NULL,
	"quantity_before" integer,
	"quantity_after" integer,
	"delta" integer DEFAULT 0 NOT NULL,
	"location_id" text,
	"order_id" text,
	"ref_id" text,
	"by_user_id" text,
	"by_name" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_stock_moves" ADD CONSTRAINT "store_stock_moves_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_stock_moves" ADD CONSTRAINT "store_stock_moves_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_stock_moves_variant_idx" ON "store_stock_moves" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_stock_moves_company_idx" ON "store_stock_moves" USING btree ("company_id","created_at");