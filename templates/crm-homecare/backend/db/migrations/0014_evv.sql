-- EVV: Sandata alternate-EVV submission + weekly EVV units (ported from the CVHC CRM,
-- migration_v61_alt_evv, cvhc-agent/migration_evv_autosubmit and migration_v72_evv_weekly_units).
-- Strictly additive: new columns and new tables only.
--
-- Sandata is used by many states, so nothing here is Wisconsin-only except the payer-code
-- backfill, which runs only when the agency itself is in Wisconsin.

-- ── Agency Sandata account (per agency, editable in Integrations → EVV) ──────────────────────
-- The Medicaid provider id Sandata calls ProviderID is the existing agencies.medicaid_id.
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "sandata_username" text;
--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "sandata_password_encrypted" text;
--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "sandata_account_id" text;
--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "sandata_api_url" text;
--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "sandata_agency_id" text;
--> statement-breakpoint

-- ── Payer Sandata settings ──────────────────────────────────────────────────────────────────
-- sandata_evv_required: this payer's clients (with a Medicaid ID on file) are in Sandata, so
-- their caregivers are prompted to check in/out on Sandata Mobile Connect.
ALTER TABLE "referral_sources" ADD COLUMN IF NOT EXISTS "sandata_payer_id" text;
--> statement-breakpoint
ALTER TABLE "referral_sources" ADD COLUMN IF NOT EXISTS "sandata_payer_program" text;
--> statement-breakpoint
ALTER TABLE "referral_sources" ADD COLUMN IF NOT EXISTS "sandata_evv_required" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- The CVHC rule was "Family Care MCO payers"; carry that flag over for rows that already say so.
UPDATE "referral_sources" SET "sandata_evv_required" = true
 WHERE "payer_type" = 'mco_family_care' AND "sandata_evv_required" = false;
--> statement-breakpoint
-- Wisconsin DMS payer codes (WI Alt-EVV Addendum v2.6, Appendix 1) — only for a Wisconsin agency.
UPDATE "referral_sources" SET "sandata_payer_id" = 'MCFC-CW', "sandata_payer_program" = 'WIMCO'
 WHERE "name" ILIKE '%my choice%' AND "sandata_payer_id" IS NULL
   AND EXISTS (SELECT 1 FROM "agencies" WHERE upper(trim(coalesce("state", ''))) IN ('WI', 'WISCONSIN'));
--> statement-breakpoint
UPDATE "referral_sources" SET "sandata_payer_id" = 'INCLUSA', "sandata_payer_program" = 'WIMCO'
 WHERE "name" ILIKE '%inclusa%' AND "sandata_payer_id" IS NULL
   AND EXISTS (SELECT 1 FROM "agencies" WHERE upper(trim(coalesce("state", ''))) IN ('WI', 'WISCONSIN'));
--> statement-breakpoint
UPDATE "referral_sources" SET "sandata_payer_id" = 'LAKELAND', "sandata_payer_program" = 'WIMCO'
 WHERE "name" ILIKE '%lakeland%' AND "sandata_payer_id" IS NULL
   AND EXISTS (SELECT 1 FROM "agencies" WHERE upper(trim(coalesce("state", ''))) IN ('WI', 'WISCONSIN'));
--> statement-breakpoint
UPDATE "referral_sources" SET "sandata_payer_id" = 'WIMOLINA', "sandata_payer_program" = 'WIHMO'
 WHERE "name" ILIKE '%molina%' AND "sandata_payer_id" IS NULL
   AND EXISTS (SELECT 1 FROM "agencies" WHERE upper(trim(coalesce("state", ''))) IN ('WI', 'WISCONSIN'));
--> statement-breakpoint
UPDATE "referral_sources" SET "sandata_payer_id" = 'WIFFS', "sandata_payer_program" = 'FFS'
 WHERE "name" ILIKE '%forwardhealth%' AND "sandata_payer_id" IS NULL
   AND EXISTS (SELECT 1 FROM "agencies" WHERE upper(trim(coalesce("state", ''))) IN ('WI', 'WISCONSIN'));
--> statement-breakpoint

-- ── Client sync state (Sandata must accept the client before its visits) + weekly EVV units ──
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "sandata_sequence" bigint DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "sandata_synced_at" timestamp;
--> statement-breakpoint
-- EVV units per Sun–Sat week (1 unit = 15 min). NULL = not entered (prompt every visit);
-- 0 = no EVV hours (never prompt). The 0–672 range is enforced by its only writer,
-- PATCH /api/clients/:id/evv-units — no CHECK constraint, because schema.ts declares none and
-- the boot-time drizzle push would otherwise fight it.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "evv_weekly_units" integer;
--> statement-breakpoint

-- ── Visit submission state ──────────────────────────────────────────────────────────────────
ALTER TABLE "evv_visits" ADD COLUMN IF NOT EXISTS "sandata_sequence" bigint DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "evv_visits" ADD COLUMN IF NOT EXISTS "sandata_uuid" text;
--> statement-breakpoint
ALTER TABLE "evv_visits" ADD COLUMN IF NOT EXISTS "needs_resubmit" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "evv_visits" ADD COLUMN IF NOT EXISTS "auto_submit_enabled" boolean DEFAULT true;
--> statement-breakpoint
ALTER TABLE "evv_visits" ADD COLUMN IF NOT EXISTS "exception_ack" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "evv_visits" ADD COLUMN IF NOT EXISTS "exception_ack_by_id" text REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "evv_visits" ADD COLUMN IF NOT EXISTS "exception_ack_at" timestamp;
--> statement-breakpoint
ALTER TABLE "evv_visits" ADD COLUMN IF NOT EXISTS "exception_ack_reason" text;
--> statement-breakpoint
ALTER TABLE "evv_visits" ADD COLUMN IF NOT EXISTS "exception_ack_memo" text;
--> statement-breakpoint

-- ── Time entries: IVR caller number (Telephony calls) + the per-visit Sandata decision ──────
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "origin_phone" text;
--> statement-breakpoint
-- Decided at clock-in: true = sent to Sandata (counts toward the week), false = not sent,
-- NULL = visit predates this column / no decision.
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "sandata_required" boolean;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_client_start_idx" ON "time_entries" ("client_id", "start_time");
--> statement-breakpoint

-- ── Structured time-change log (Sandata VisitChanges) ───────────────────────────────────────
-- Reason codes: 1 Caregiver Error, 2 Member Unavailable, 3 Mobile Device Issue, 4 Telephony
-- Issue, 5 Member Refused Verification (memo required), 7 Missing in System, 8 Other (memo
-- required). Resolution 1 = Written Documentation Maintained. Codes are validated by the one
-- writer, services/evvVisits.ts recordVisitTimeChange(). Codes are validated by the one
-- writer, services/evvVisits.ts recordVisitTimeChange().
CREATE TABLE IF NOT EXISTS "visit_time_changes" (
  "id" text PRIMARY KEY NOT NULL,
  "time_entry_id" text NOT NULL REFERENCES "time_entries"("id") ON DELETE CASCADE,
  "changed_by_id" text REFERENCES "users"("id"),
  "changed_at" timestamp DEFAULT now() NOT NULL,
  "old_start" timestamp,
  "new_start" timestamp,
  "old_end" timestamp,
  "new_end" timestamp,
  "reason_code" text NOT NULL,
  "memo" text,
  "resolution_code" text DEFAULT '1',
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_time_changes_entry_idx" ON "visit_time_changes" ("time_entry_id");
--> statement-breakpoint

-- ── Submission queue (serialized, retried, permanent errors → needs_manual) ─────────────────
CREATE TABLE IF NOT EXISTS "sandata_submission_queue" (
  "id" text PRIMARY KEY NOT NULL,
  "evv_visit_id" text NOT NULL REFERENCES "evv_visits"("id") ON DELETE CASCADE,
  "submission_path" text DEFAULT 'api' NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "retry_count" integer DEFAULT 0,
  "last_error" text,
  "next_retry_at" timestamp,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandata_queue_status_idx" ON "sandata_submission_queue" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandata_queue_evv_idx" ON "sandata_submission_queue" ("evv_visit_id");
