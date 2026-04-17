-- Storm radar overlay — Storm tier feature
--
-- The storm_event table already exists from migration 0000 with basic
-- columns (event_date, event_type, affected_zip_codes, etc.). This
-- migration adds radar-specific columns needed by the storm radar feature
-- and creates the storm_event_match table for contact matching.

-- Add radar-specific columns to existing storm_event table
ALTER TABLE "storm_event" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'noaa';
ALTER TABLE "storm_event" ADD COLUMN IF NOT EXISTS "provider_event_id" text;
ALTER TABLE "storm_event" ADD COLUMN IF NOT EXISTS "severity" text;
ALTER TABLE "storm_event" ADD COLUMN IF NOT EXISTS "lat" real;
ALTER TABLE "storm_event" ADD COLUMN IF NOT EXISTS "lng" real;
ALTER TABLE "storm_event" ADD COLUMN IF NOT EXISTS "radius_miles" numeric(6, 2);
ALTER TABLE "storm_event" ADD COLUMN IF NOT EXISTS "state" text;
ALTER TABLE "storm_event" ADD COLUMN IF NOT EXISTS "city" text;
ALTER TABLE "storm_event" ADD COLUMN IF NOT EXISTS "zip" text;
ALTER TABLE "storm_event" ADD COLUMN IF NOT EXISTS "started_at" timestamp;
ALTER TABLE "storm_event" ADD COLUMN IF NOT EXISTS "ended_at" timestamp;
ALTER TABLE "storm_event" ADD COLUMN IF NOT EXISTS "raw_payload" json;
ALTER TABLE "storm_event" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();

-- Now safe to create indexes on the new columns
CREATE INDEX IF NOT EXISTS "storm_event_state_idx" ON "storm_event" ("state");
CREATE INDEX IF NOT EXISTS "storm_event_zip_idx" ON "storm_event" ("zip");
CREATE INDEX IF NOT EXISTS "storm_event_started_at_idx" ON "storm_event" ("started_at");

-- storm_event_match joins storm events to contacts whose address falls in
-- the affected area.
CREATE TABLE IF NOT EXISTS "storm_event_match" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"storm_event_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"distance_miles" numeric(6, 2),
	"status" text DEFAULT 'new' NOT NULL,
	"contacted_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "storm_event_match_company_id_idx" ON "storm_event_match" ("company_id");
CREATE INDEX IF NOT EXISTS "storm_event_match_storm_event_id_idx" ON "storm_event_match" ("storm_event_id");
CREATE INDEX IF NOT EXISTS "storm_event_match_status_idx" ON "storm_event_match" ("status");
