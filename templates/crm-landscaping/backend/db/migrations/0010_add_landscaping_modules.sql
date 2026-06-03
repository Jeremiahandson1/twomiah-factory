-- Landscaping vertical modules: area-based pricing, snow billing, recurring-route board

-- Area-based pricing: measured serviceable areas on the property
ALTER TABLE "site" ADD COLUMN IF NOT EXISTS "lawn_sqft" integer;
ALTER TABLE "site" ADD COLUMN IF NOT EXISTS "bed_sqft" integer;
ALTER TABLE "site" ADD COLUMN IF NOT EXISTS "hardscape_sqft" integer;
ALTER TABLE "site" ADD COLUMN IF NOT EXISTS "lot_sqft" integer;
ALTER TABLE "site" ADD COLUMN IF NOT EXISTS "driveway_sqft" integer;
ALTER TABLE "site" ADD COLUMN IF NOT EXISTS "measured_at" timestamp;
ALTER TABLE "site" ADD COLUMN IF NOT EXISTS "measurement_source" text;

CREATE TABLE IF NOT EXISTS "service_rate" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "service_type" text NOT NULL,
  "area_field" text DEFAULT 'lawnSqft' NOT NULL,
  "rate_per_1000_sqft" numeric(12, 2) NOT NULL,
  "min_charge" numeric(12, 2) DEFAULT '0' NOT NULL,
  "unit_label" text DEFAULT 'per visit',
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "service_rate_company_id_idx" ON "service_rate" ("company_id");
CREATE INDEX IF NOT EXISTS "service_rate_service_type_idx" ON "service_rate" ("service_type");

CREATE TABLE IF NOT EXISTS "snow_contract" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "site_id" text NOT NULL,
  "contact_id" text,
  "billing_mode" text DEFAULT 'per_push' NOT NULL,
  "per_push_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
  "per_event_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
  "per_inch_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
  "seasonal_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
  "trigger_depth_inches" numeric(5, 2) DEFAULT '2' NOT NULL,
  "salt_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "snow_contract_company_id_idx" ON "snow_contract" ("company_id");
CREATE INDEX IF NOT EXISTS "snow_contract_site_id_idx" ON "snow_contract" ("site_id");
CREATE INDEX IF NOT EXISTS "snow_contract_status_idx" ON "snow_contract" ("status");

CREATE TABLE IF NOT EXISTS "snow_event" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "snow_contract_id" text NOT NULL,
  "site_id" text NOT NULL,
  "serviced_at" timestamp DEFAULT now() NOT NULL,
  "pushes" integer DEFAULT 1 NOT NULL,
  "snowfall_inches" numeric(5, 2) DEFAULT '0' NOT NULL,
  "salt_applied" boolean DEFAULT false NOT NULL,
  "billable_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "billing_mode" text NOT NULL,
  "invoice_id" text,
  "assigned_to_id" text,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "snow_event_company_id_idx" ON "snow_event" ("company_id");
CREATE INDEX IF NOT EXISTS "snow_event_contract_id_idx" ON "snow_event" ("snow_contract_id");
CREATE INDEX IF NOT EXISTS "snow_event_serviced_at_idx" ON "snow_event" ("serviced_at");

CREATE TABLE IF NOT EXISTS "recurring_route" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "name" text NOT NULL,
  "day_of_week" integer NOT NULL,
  "assigned_to_id" text,
  "estimated_hours" numeric(5, 2) DEFAULT '0' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "recurring_route_company_id_idx" ON "recurring_route" ("company_id");
CREATE INDEX IF NOT EXISTS "recurring_route_day_of_week_idx" ON "recurring_route" ("day_of_week");

CREATE TABLE IF NOT EXISTS "recurring_route_stop" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "recurring_route_id" text NOT NULL,
  "site_id" text NOT NULL,
  "contact_id" text,
  "service_type" text DEFAULT 'mowing' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "estimated_minutes" integer DEFAULT 30 NOT NULL,
  "price_per_visit" numeric(12, 2) DEFAULT '0' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "recurring_route_stop_route_id_idx" ON "recurring_route_stop" ("recurring_route_id");
CREATE INDEX IF NOT EXISTS "recurring_route_stop_company_id_idx" ON "recurring_route_stop" ("company_id");
