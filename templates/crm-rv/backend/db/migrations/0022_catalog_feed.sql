-- Phase 3: per-dealer distributor price/cost feed config. Scheduled refresh keeps
-- catalog pricing + stocked-item costs current from a distributor/OEM price file.

CREATE TABLE IF NOT EXISTS "catalog_feed" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"provider" text DEFAULT 'generic' NOT NULL,
	"feed_url" text,
	"format" text DEFAULT 'csv' NOT NULL,
	"default_oem" text,
	"last_sync_at" timestamp,
	"last_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_feed" ADD CONSTRAINT "catalog_feed_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_feed_company_key" ON "catalog_feed" ("company_id");
