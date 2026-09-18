-- Fix Storm Radar table drift (see FIX-MAP C5).
-- Migration 0009 mistakenly added radar columns to the existing storm_event
-- (the Storm *Leads* table) and created storm_event_match with a storm_event_id
-- column. The schema's Storm *Radar* feature expects a dedicated
-- storm_radar_event table and a storm_radar_event_id foreign-key column, so the
-- storm-radar API (/events, /matches) errors with "relation/column does not
-- exist" and the page falls back to a developer-facing setup message. This
-- migration creates the missing table and aligns the column name. Additive.

CREATE TABLE IF NOT EXISTS "storm_radar_event" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"provider" text DEFAULT 'noaa' NOT NULL,
	"provider_event_id" text,
	"event_type" text NOT NULL,
	"severity" text,
	"hail_size_inches" numeric(4, 2),
	"wind_speed_mph" integer,
	"description" text,
	"lat" real,
	"lng" real,
	"radius_miles" numeric(6, 2),
	"state" text,
	"city" text,
	"zip" text,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"raw_payload" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "storm_radar_event_company_id_idx" ON "storm_radar_event" ("company_id");
CREATE INDEX IF NOT EXISTS "storm_radar_event_state_idx" ON "storm_radar_event" ("state");
CREATE INDEX IF NOT EXISTS "storm_radar_event_zip_idx" ON "storm_radar_event" ("zip");
CREATE INDEX IF NOT EXISTS "storm_radar_event_started_at_idx" ON "storm_radar_event" ("started_at");
ALTER TABLE "storm_event_match" RENAME COLUMN "storm_event_id" TO "storm_radar_event_id";
