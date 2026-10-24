CREATE TABLE IF NOT EXISTS "store_customer_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"percent_off" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_customer_group_members" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"group_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"order_id" text,
	"provider" text NOT NULL,
	"provider_dispute_id" text NOT NULL,
	"provider_payment_id" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"reason" text,
	"status" text NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"evidence_due_by" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_group_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"price_cents" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bar_gift_card" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "bar_gift_card_ledger" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "bar_gift_card_ledger" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillment" text DEFAULT 'ship' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "source" text DEFAULT 'storefront' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_automatic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gift_card_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gift_card_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gift_card_refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_group_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "dispute_status" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ready_for_pickup_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "picked_up_at" timestamp;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "kind" text DEFAULT 'physical' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "condition" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "bought_together_ids" json;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "also_like_ids" json;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "gtin" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "mpn" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "stripe_tax_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "pickup_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "pickup_address" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "pickup_hours" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "feed_token" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_customer_groups" ADD CONSTRAINT "store_customer_groups_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_customer_group_members" ADD CONSTRAINT "store_customer_group_members_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_customer_group_members" ADD CONSTRAINT "store_customer_group_members_group_id_store_customer_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."store_customer_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_customer_group_members" ADD CONSTRAINT "store_customer_group_members_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_disputes" ADD CONSTRAINT "store_disputes_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_disputes" ADD CONSTRAINT "store_disputes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_group_prices" ADD CONSTRAINT "store_group_prices_group_id_store_customer_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."store_customer_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_group_prices" ADD CONSTRAINT "store_group_prices_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_customer_groups_company_name_unique" ON "store_customer_groups" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_customer_group_members_contact_unique" ON "store_customer_group_members" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_customer_group_members_group_idx" ON "store_customer_group_members" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_disputes_provider_dispute_unique" ON "store_disputes" USING btree ("provider","provider_dispute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_disputes_company_idx" ON "store_disputes" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_group_prices_group_variant_unique" ON "store_group_prices" USING btree ("group_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_gift_card_ledger_company_key_key" ON "bar_gift_card_ledger" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_provider_payment_idx" ON "orders" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_company_status_position_idx" ON "products" USING btree ("company_id","status","position");