CREATE TABLE IF NOT EXISTS "client_update_reaction" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"log_id" text NOT NULL,
	"contact_id" text,
	"kind" text NOT NULL,
	"body" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bid_invite" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"package_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"prices" json DEFAULT '[]'::json NOT NULL,
	"total" numeric(12, 2),
	"notes" text,
	"declined_reason" text,
	"viewed_at" timestamp,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bid_package" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"scope" text,
	"due_date" timestamp,
	"lines" json DEFAULT '[]'::json NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"awarded_invite_id" text,
	"purchase_order_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_stock_level" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "skills" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "shared_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "lat" real;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "lng" real;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "geocoded_at" timestamp;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "square_feet" integer;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "builders_risk" json;--> statement-breakpoint
ALTER TABLE "daily_log" ADD COLUMN "shared_at" timestamp;--> statement-breakpoint
ALTER TABLE "job_photo" ADD COLUMN "shared_at" timestamp;--> statement-breakpoint
ALTER TABLE "client_account_entry" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "inspection_report" ADD COLUMN "shared_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stock_takes" json;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_update_reaction" ADD CONSTRAINT "client_update_reaction_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_update_reaction" ADD CONSTRAINT "client_update_reaction_log_id_reminder_log_id_fk" FOREIGN KEY ("log_id") REFERENCES "public"."reminder_log"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_invite" ADD CONSTRAINT "bid_invite_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_invite" ADD CONSTRAINT "bid_invite_package_id_bid_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."bid_package"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_invite" ADD CONSTRAINT "bid_invite_vendor_id_contact_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_package" ADD CONSTRAINT "bid_package_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_package" ADD CONSTRAINT "bid_package_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_package" ADD CONSTRAINT "bid_package_purchase_order_id_job_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."job_purchase_order"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_package" ADD CONSTRAINT "bid_package_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
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
CREATE INDEX IF NOT EXISTS "client_update_reaction_log_idx" ON "client_update_reaction" USING btree ("log_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bid_invite_package_vendor_unique" ON "bid_invite" USING btree ("package_id","vendor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_invite_vendor_idx" ON "bid_invite" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_package_company_idx" ON "bid_package" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_package_project_idx" ON "bid_package" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_stock_level_variant_location_unique" ON "store_stock_level" USING btree ("variant_id","location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_stock_level_company_idx" ON "store_stock_level" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_account_entry_number_unique" ON "client_account_entry" USING btree ("company_id","number");