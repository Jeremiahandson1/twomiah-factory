-- Storm radar overlay — Storm tier feature
--
-- Caches weather events (hail, wind, tornado) near customer addresses for
-- lead generation. Populated by a scheduled sync job that calls a weather
-- API (NOAA Storm Events, Tomorrow.io, or AccuWeather — pluggable via
-- services/stormRadar.ts).
--
-- Each storm event can match one or more contacts by zip/city, and
-- matched events drive storm lead generation campaigns.

CREATE TABLE IF NOT EXISTS "storm_event" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"provider" text DEFAULT 'noaa' NOT NULL, -- noaa, tomorrow_io, accuweather
	"provider_event_id" text, -- external event ID for dedup
	"event_type" text NOT NULL, -- hail, wind, tornado, severe_thunderstorm, other
	"severity" text, -- minor, moderate, severe, extreme
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
	"raw_payload" json, -- full provider response for debugging
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "storm_event_company_id_idx" ON "storm_event" ("company_id");
CREATE INDEX IF NOT EXISTS "storm_event_state_idx" ON "storm_event" ("state");
CREATE INDEX IF NOT EXISTS "storm_event_zip_idx" ON "storm_event" ("zip");
CREATE INDEX IF NOT EXISTS "storm_event_started_at_idx" ON "storm_event" ("started_at");
CREATE UNIQUE INDEX IF NOT EXISTS "storm_event_provider_unique"
	ON "storm_event" ("company_id", "provider", "provider_event_id");

-- storm_event_match joins storm events to contacts whose address falls in
-- the affected area. Driven by the sync job after a new storm event lands.
CREATE TABLE IF NOT EXISTS "storm_event_match" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"storm_event_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"distance_miles" numeric(6, 2),
	"status" text DEFAULT 'new' NOT NULL, -- new, contacted, quoted, booked, not_interested
	"contacted_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "storm_event_match_company_id_idx" ON "storm_event_match" ("company_id");
CREATE INDEX IF NOT EXISTS "storm_event_match_storm_event_id_idx" ON "storm_event_match" ("storm_event_id");
CREATE INDEX IF NOT EXISTS "storm_event_match_status_idx" ON "storm_event_match" ("status");
