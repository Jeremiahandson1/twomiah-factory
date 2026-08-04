ALTER TABLE "orders" ADD COLUMN "supplier_order_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "supplier_status" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "supplier_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "supplier_error" text;--> statement-breakpoint
CREATE TABLE "supplier_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"credentials_enc" text NOT NULL,
	"auto_forward" boolean DEFAULT true NOT NULL,
	"connected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "variant_supplier_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"supplier_variant_ref" text NOT NULL,
	"supplier_item_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "variant_supplier_map" ADD CONSTRAINT "variant_supplier_map_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "variant_supplier_map_variant_unique" ON "variant_supplier_map" USING btree ("variant_id");