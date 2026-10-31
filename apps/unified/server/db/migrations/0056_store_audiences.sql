CREATE TABLE IF NOT EXISTS "store_audience_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"segment_id" text,
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"people" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_audience_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"purchase_events_on" boolean DEFAULT false NOT NULL,
	"meta_capi_on" boolean DEFAULT false NOT NULL,
	"meta_capi_token_enc" text,
	"meta_test_event_code" text,
	"meta_ad_account_id" text,
	"meta_access_token_enc" text,
	"google_customer_id" text,
	"google_login_customer_id" text,
	"google_developer_token_enc" text,
	"google_client_id" text,
	"google_client_secret_enc" text,
	"google_refresh_token_enc" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "store_audience_settings_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_audience_log" ADD CONSTRAINT "store_audience_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_audience_log" ADD CONSTRAINT "store_audience_log_segment_id_store_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."store_segments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_audience_settings" ADD CONSTRAINT "store_audience_settings_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_audience_log_company_idx" ON "store_audience_log" USING btree ("company_id","created_at");