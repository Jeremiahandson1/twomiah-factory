-- Fleet tier features: locations (multi-branch dispatch), commissions
-- (tech/sales commission tracking), and call_recording (extends existing
-- call_tracking with recording URLs + transcription).
--
-- Paired with routes/locations.ts, routes/commissions.ts (new), and
-- extensions to routes/calltracking.ts.

-- ═══════════════════════════════════════════════════
-- LOCATIONS — multi-branch / multi-location dispatch
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "location" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL, -- short label e.g. "CHI" for Chicago
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"phone" text,
	"email" text,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"service_area_radius_miles" integer DEFAULT 25 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"manager_user_id" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "location_company_id_idx" ON "location" ("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "location_company_code_unique" ON "location" ("company_id", "code");

-- Optional: assign techs/jobs/contacts to specific locations
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "location_id" text;
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "location_id" text;

-- ═══════════════════════════════════════════════════
-- COMMISSIONS — tech + sales rep commission tracking
-- ═══════════════════════════════════════════════════

-- Commission plan: how a given rep or tech earns commission
CREATE TABLE IF NOT EXISTS "commission_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"plan_type" text NOT NULL, -- flat_rate, percent_of_invoice, percent_of_margin, tiered
	"flat_rate_amount" numeric(10, 2), -- for flat_rate
	"percent_rate" numeric(5, 2), -- for percent_of_* plans
	"tiers" json, -- for tiered: [{ min: 0, max: 10000, rate: 5 }, ...]
	"applies_to_role" text, -- technician, sales_rep, manager, all
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp,
	"effective_to" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "commission_plan_company_id_idx" ON "commission_plan" ("company_id");

-- Individual commission record — one per earning event (job completed, invoice paid, etc)
CREATE TABLE IF NOT EXISTS "commission" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"plan_id" text,
	"user_id" text NOT NULL, -- who earns
	"job_id" text,
	"invoice_id" text,
	"base_amount" numeric(12, 2) NOT NULL, -- job revenue or invoice total
	"rate_applied" numeric(5, 2), -- % applied, if applicable
	"commission_amount" numeric(12, 2) NOT NULL,
	"earned_at" timestamp DEFAULT now() NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"status" text DEFAULT 'pending' NOT NULL, -- pending, approved, paid, disputed
	"paid_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "commission_company_id_idx" ON "commission" ("company_id");
CREATE INDEX IF NOT EXISTS "commission_user_id_idx" ON "commission" ("user_id");
CREATE INDEX IF NOT EXISTS "commission_status_idx" ON "commission" ("status");

-- ═══════════════════════════════════════════════════
-- CALL RECORDING — extend call_tracking for recording URLs
-- ═══════════════════════════════════════════════════

-- Add recording fields to existing call_tracking table (if it exists)
-- Safe-add so it doesn't fail if schema changes later.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'call_tracking') THEN
    ALTER TABLE "call_tracking" ADD COLUMN IF NOT EXISTS "recording_url" text;
    ALTER TABLE "call_tracking" ADD COLUMN IF NOT EXISTS "recording_duration" integer;
    ALTER TABLE "call_tracking" ADD COLUMN IF NOT EXISTS "transcription" text;
    ALTER TABLE "call_tracking" ADD COLUMN IF NOT EXISTS "transcription_status" text;
    ALTER TABLE "call_tracking" ADD COLUMN IF NOT EXISTS "recording_consent" boolean DEFAULT false;
  END IF;
END $$;
