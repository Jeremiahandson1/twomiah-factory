-- Migration 0008: CVHC Parity
-- Brings the crm-homecare template to full feature parity with the
-- battle-tested Chippewa Valley Home Care CRM.

-- ==================== NEW TABLES ====================

-- Schedule exceptions: per-occurrence cancel/modify for recurring schedules
CREATE TABLE IF NOT EXISTS "schedule_exceptions" (
  "id" text PRIMARY KEY NOT NULL,
  "schedule_id" text NOT NULL REFERENCES "schedules"("id") ON DELETE CASCADE,
  "exception_date" date NOT NULL,
  "exception_type" text NOT NULL,
  "override_start_time" time,
  "override_end_time" time,
  "override_caregiver_id" text REFERENCES "users"("id"),
  "override_client_id" text REFERENCES "clients"("id"),
  "override_notes" text,
  "created_by" text REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "schedule_exceptions_schedule_date_idx" ON "schedule_exceptions" ("schedule_id", "exception_date");
CREATE INDEX IF NOT EXISTS "schedule_exceptions_schedule_id_idx" ON "schedule_exceptions" ("schedule_id");
CREATE INDEX IF NOT EXISTS "schedule_exceptions_date_idx" ON "schedule_exceptions" ("exception_date");

-- Payroll shift reviews: professional shift-level reconciliation
CREATE TABLE IF NOT EXISTS "payroll_shift_reviews" (
  "id" text PRIMARY KEY NOT NULL,
  "pay_period_start" date NOT NULL,
  "pay_period_end" date NOT NULL,
  "caregiver_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "client_id" text REFERENCES "clients"("id") ON DELETE SET NULL,
  "schedule_id" text REFERENCES "schedules"("id") ON DELETE SET NULL,
  "time_entry_id" text REFERENCES "time_entries"("id") ON DELETE SET NULL,
  "shift_date" date NOT NULL,
  "scheduled_start" time,
  "scheduled_end" time,
  "scheduled_minutes" integer,
  "actual_start" timestamp,
  "actual_end" timestamp,
  "actual_minutes" integer,
  "payable_minutes" integer,
  "status" text DEFAULT 'pending' NOT NULL,
  "flag_reason" text,
  "resolution_notes" text,
  "reviewed_by" text REFERENCES "users"("id"),
  "reviewed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "payroll_shift_reviews_period_idx" ON "payroll_shift_reviews" ("pay_period_start", "pay_period_end");
CREATE INDEX IF NOT EXISTS "payroll_shift_reviews_caregiver_idx" ON "payroll_shift_reviews" ("caregiver_id");
CREATE INDEX IF NOT EXISTS "payroll_shift_reviews_status_idx" ON "payroll_shift_reviews" ("status");

-- Caregiver rates: rate history with effective dates
CREATE TABLE IF NOT EXISTS "caregiver_rates" (
  "id" text PRIMARY KEY NOT NULL,
  "caregiver_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "rate_type" text DEFAULT 'base' NOT NULL,
  "hourly_rate" numeric(8, 2) NOT NULL,
  "effective_date" date NOT NULL,
  "end_date" date,
  "notes" text,
  "created_by_id" text REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "caregiver_rates_caregiver_idx" ON "caregiver_rates" ("caregiver_id");
CREATE INDEX IF NOT EXISTS "caregiver_rates_effective_date_idx" ON "caregiver_rates" ("effective_date");

-- Certification alerts: cert expiration monitoring
CREATE TABLE IF NOT EXISTS "certification_alerts" (
  "id" text PRIMARY KEY NOT NULL,
  "caregiver_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "certification_record_id" text REFERENCES "certification_records"("id") ON DELETE CASCADE,
  "certification_type" text NOT NULL,
  "expiry_date" date NOT NULL,
  "alert_type" text DEFAULT 'expiring_soon' NOT NULL,
  "days_until_expiry" integer,
  "status" text DEFAULT 'active' NOT NULL,
  "acknowledged_at" timestamp,
  "acknowledged_by_id" text REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "certification_alerts_caregiver_idx" ON "certification_alerts" ("caregiver_id");
CREATE INDEX IF NOT EXISTS "certification_alerts_status_idx" ON "certification_alerts" ("status");

-- ==================== NEW COLUMNS ON EXISTING TABLES ====================

-- Users: IVR PIN for phone clock-in (unique to prevent collisions)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ivr_pin" text;
CREATE UNIQUE INDEX IF NOT EXISTS "users_ivr_pin_unique" ON "users" ("ivr_pin");

-- Clients: billing, authorization, location, and IVR fields
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "care_type_id" text;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "is_private_pay" boolean DEFAULT false NOT NULL;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "private_pay_rate" numeric(8, 2);
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "private_pay_rate_type" text DEFAULT 'hourly';
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "weekly_authorized_units" numeric(8, 2);
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "service_days_per_week" integer;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "service_allowed_days" json;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "assistance_needs" text;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "billing_notes" text;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "latitude" numeric(10, 8);
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "longitude" numeric(11, 8);
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "ivr_code" text;
CREATE UNIQUE INDEX IF NOT EXISTS "clients_ivr_code_unique" ON "clients" ("ivr_code");
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "medicaid_id" text;

-- Schedules: end date for recurring patterns
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "end_date" date;

-- Absences: notes and status
ALTER TABLE "absences" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE "absences" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'reported' NOT NULL;

-- Referral sources: IRIS FEA routing + billing contact
ALTER TABLE "referral_sources" ADD COLUMN IF NOT EXISTS "fea_organization" text;
ALTER TABLE "referral_sources" ADD COLUMN IF NOT EXISTS "billing_address" text;
ALTER TABLE "referral_sources" ADD COLUMN IF NOT EXISTS "billing_contact_name" text;
ALTER TABLE "referral_sources" ADD COLUMN IF NOT EXISTS "billing_contact_email" text;
ALTER TABLE "referral_sources" ADD COLUMN IF NOT EXISTS "billing_contact_phone" text;

-- Invoices: referral source, type, payment tracking
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "referral_source_id" text REFERENCES "referral_sources"("id");
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "invoice_type" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "paid_at" timestamp;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "amount_paid" numeric(12, 2);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "amount_adjusted" numeric(12, 2);

-- Invoice line items: service date
ALTER TABLE "invoice_line_items" ADD COLUMN IF NOT EXISTS "service_date" date;

-- Claims: accepted date
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "accepted_date" date;

-- Background checks: reference number and findings
ALTER TABLE "background_checks" ADD COLUMN IF NOT EXISTS "reference_number" text;
ALTER TABLE "background_checks" ADD COLUMN IF NOT EXISTS "findings" text;

-- Audit logs: reason code for compliance
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "reason_code" text;

-- Incidents: witnesses, injuries, follow-up
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "witnesses" text;
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "injuries_or_damage" text;
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "follow_up_required" boolean DEFAULT false NOT NULL;

-- Medications: pharmacy, Rx, clinical fields
ALTER TABLE "medications" ADD COLUMN IF NOT EXISTS "pharmacy" text;
ALTER TABLE "medications" ADD COLUMN IF NOT EXISTS "rx_number" text;
ALTER TABLE "medications" ADD COLUMN IF NOT EXISTS "instructions" text;
ALTER TABLE "medications" ADD COLUMN IF NOT EXISTS "side_effects" text;
ALTER TABLE "medications" ADD COLUMN IF NOT EXISTS "is_prn" boolean DEFAULT false NOT NULL;

-- EDI batches: file path
ALTER TABLE "edi_batches" ADD COLUMN IF NOT EXISTS "file_path" text;

-- Authorizations: renewal tracking
ALTER TABLE "authorizations" ADD COLUMN IF NOT EXISTS "renewal_requested" boolean DEFAULT false NOT NULL;
ALTER TABLE "authorizations" ADD COLUMN IF NOT EXISTS "renewal_requested_at" timestamp;
ALTER TABLE "authorizations" ADD COLUMN IF NOT EXISTS "renewal_requested_by" text REFERENCES "users"("id");

-- ==================== NEW INDEXES ====================

CREATE INDEX IF NOT EXISTS "time_entries_caregiver_complete_idx" ON "time_entries" ("caregiver_id", "is_complete");
CREATE INDEX IF NOT EXISTS "time_entries_period_idx" ON "time_entries" ("start_time", "end_time");
CREATE INDEX IF NOT EXISTS "gps_tracking_entry_timestamp_idx" ON "gps_tracking" ("time_entry_id", "timestamp");
DROP INDEX IF EXISTS "idx_claims_denial";
CREATE INDEX IF NOT EXISTS "idx_claims_denial" ON "claims" ("status", "denial_code");
CREATE INDEX IF NOT EXISTS "clients_active_service_idx" ON "clients" ("is_active", "service_type");
CREATE INDEX IF NOT EXISTS "invoices_period_status_idx" ON "invoices" ("billing_period_start", "billing_period_end", "payment_status");
CREATE INDEX IF NOT EXISTS "referral_sources_active_type_idx" ON "referral_sources" ("is_active", "type");
