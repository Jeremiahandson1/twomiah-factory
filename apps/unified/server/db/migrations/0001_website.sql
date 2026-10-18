CREATE TABLE IF NOT EXISTS "email_alias" (
	"id" text PRIMARY KEY NOT NULL,
	"local_part" text NOT NULL,
	"routing_mode" text DEFAULT 'forward' NOT NULL,
	"forward_to" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "photo" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text,
	"entity_type" text,
	"entity_id" text,
	"filename" text NOT NULL,
	"original_name" text,
	"mime_type" text DEFAULT 'image/jpeg' NOT NULL,
	"size" integer,
	"width" integer,
	"height" integer,
	"thumbnail_path" text,
	"caption" text,
	"tags" json,
	"is_public" boolean DEFAULT false NOT NULL,
	"public_url" text,
	"alt" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'lead' NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"email" text,
	"phone" text,
	"mobile" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"lat" real,
	"lng" real,
	"notes" text,
	"source" text,
	"tags" json DEFAULT '[]'::json NOT NULL,
	"custom_fields" json DEFAULT '{}'::json NOT NULL,
	"qb_customer_id" text,
	"portal_enabled" boolean DEFAULT false NOT NULL,
	"portal_token" text,
	"portal_token_exp" timestamp,
	"last_portal_visit" timestamp,
	"opted_out_sms" boolean DEFAULT false NOT NULL,
	"email_opt_out" boolean DEFAULT false NOT NULL,
	"email_opt_out_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead" (
	"id" text PRIMARY KEY NOT NULL,
	"source_platform" text NOT NULL,
	"source_id" text,
	"homeowner_name" text NOT NULL,
	"email" text,
	"phone" text,
	"job_type" text,
	"location" text,
	"budget" text,
	"description" text,
	"status" text DEFAULT 'new' NOT NULL,
	"raw_payload" json,
	"converted_contact_id" text,
	"contacted_at" timestamp,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_source" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"label" text NOT NULL,
	"inbound_email" text,
	"webhook_url" text,
	"webhook_secret" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" json DEFAULT '{}'::json NOT NULL,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "page" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"sections" json DEFAULT '[]'::json NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"is_published" boolean DEFAULT true NOT NULL,
	"nav_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "page_view" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"day" text NOT NULL,
	"path" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_item" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"summary" text,
	"body" text DEFAULT '' NOT NULL,
	"cover_image_url" text,
	"photos" json DEFAULT '[]'::json NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"body" text DEFAULT '' NOT NULL,
	"cover_image_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"tagline" text,
	"seo_title" text,
	"seo_description" text,
	"nav" json DEFAULT '[]'::json NOT NULL,
	"photo_credits" json DEFAULT '[]'::json NOT NULL,
	"content_gaps" json DEFAULT '[]'::json NOT NULL,
	"service_areas" json DEFAULT '[]'::json NOT NULL,
	"inventory_feed_url" text,
	"contact_cta_label" text DEFAULT 'Get in touch' NOT NULL,
	"accent_color" text,
	"favicon_url" text,
	"google_tag_manager_id" text,
	"google_analytics_id" text,
	"google_ads_id" text,
	"facebook_pixel_id" text,
	"microsoft_clarity_id" text,
	"customizer_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "photo" ADD CONSTRAINT "photo_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "photo" ADD CONSTRAINT "photo_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact" ADD CONSTRAINT "contact_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead" ADD CONSTRAINT "lead_source_id_lead_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_source"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead" ADD CONSTRAINT "lead_converted_contact_id_contact_id_fk" FOREIGN KEY ("converted_contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead" ADD CONSTRAINT "lead_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_source" ADD CONSTRAINT "lead_source_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "page" ADD CONSTRAINT "page_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "page_view" ADD CONSTRAINT "page_view_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portfolio_item" ADD CONSTRAINT "portfolio_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post" ADD CONSTRAINT "post_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site" ADD CONSTRAINT "site_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_alias_local_part_idx" ON "email_alias" USING btree ("local_part");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_company_id_idx" ON "photo" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_entity_type_entity_id_idx" ON "photo" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_company_id_idx" ON "contact" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_type_idx" ON "contact" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_company_id_idx" ON "lead" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_status_idx" ON "lead" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_platform_idx" ON "lead" USING btree ("source_platform");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_received_at_idx" ON "lead" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_source_company_id_idx" ON "lead_source" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_source_platform_idx" ON "lead_source" USING btree ("platform");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "page_company_id_slug_key" ON "page" USING btree ("company_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "page_view_company_id_day_path_key" ON "page_view" USING btree ("company_id","day","path");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_item_company_id_slug_key" ON "portfolio_item" USING btree ("company_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_item_status_sort_order_idx" ON "portfolio_item" USING btree ("status","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "post_company_id_slug_key" ON "post" USING btree ("company_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_status_published_at_idx" ON "post" USING btree ("status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "site_company_id_key" ON "site" USING btree ("company_id");