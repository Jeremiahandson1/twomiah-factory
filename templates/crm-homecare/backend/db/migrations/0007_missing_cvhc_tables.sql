-- Migration: Add missing tables from CVHC CRM
-- Tables: service_pricing, referral_source_rates, invoice_adjustments,
--         claim_status_history, denial_code_lookup, sms_templates,
--         route_plans, route_plan_stops, optimizer_runs,
--         service_capabilities, caregiver_capabilities,
--         client_caregiver_restrictions, compliance_documents,
--         document_acknowledgments, application_status_history,
--         family_members, family_messages, payroll_records, payroll_line_items

CREATE TABLE IF NOT EXISTS "service_pricing" (
  "id" text PRIMARY KEY NOT NULL,
  "service_type" text NOT NULL,
  "description" text,
  "client_hourly_rate" numeric(8, 2),
  "caregiver_hourly_rate" numeric(8, 2),
  "margin_percent" numeric(5, 2),
  "is_active" boolean DEFAULT true NOT NULL,
  "effective_date" date,
  "end_date" date,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "service_pricing_service_type_idx" ON "service_pricing" ("service_type");
CREATE INDEX IF NOT EXISTS "service_pricing_is_active_idx" ON "service_pricing" ("is_active");

CREATE TABLE IF NOT EXISTS "referral_source_rates" (
  "id" text PRIMARY KEY NOT NULL,
  "referral_source_id" text NOT NULL REFERENCES "referral_sources"("id") ON DELETE CASCADE,
  "care_type_id" text REFERENCES "care_types"("id"),
  "rate_amount" numeric(8, 2) NOT NULL,
  "rate_type" text DEFAULT 'hourly' NOT NULL,
  "effective_date" date,
  "end_date" date,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "referral_source_rates_referral_source_id_idx" ON "referral_source_rates" ("referral_source_id");
CREATE INDEX IF NOT EXISTS "referral_source_rates_care_type_id_idx" ON "referral_source_rates" ("care_type_id");

CREATE TABLE IF NOT EXISTS "invoice_adjustments" (
  "id" text PRIMARY KEY NOT NULL,
  "invoice_id" text NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "adjustment_type" text NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "reason" text,
  "notes" text,
  "created_by_id" text REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "invoice_adjustments_invoice_id_idx" ON "invoice_adjustments" ("invoice_id");

CREATE TABLE IF NOT EXISTS "claim_status_history" (
  "id" text PRIMARY KEY NOT NULL,
  "claim_id" text NOT NULL REFERENCES "claims"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "notes" text,
  "created_by" text REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "claim_status_history_claim_id_idx" ON "claim_status_history" ("claim_id");

CREATE TABLE IF NOT EXISTS "denial_code_lookup" (
  "id" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL UNIQUE,
  "description" text NOT NULL,
  "category" text,
  "remediation" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "sms_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "body" text NOT NULL,
  "category" text,
  "variables" jsonb DEFAULT '[]' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "route_plans" (
  "id" text PRIMARY KEY NOT NULL,
  "caregiver_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "total_distance_miles" numeric(8, 2),
  "total_duration_minutes" integer,
  "optimized_at" timestamp,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "route_plans_caregiver_date_idx" ON "route_plans" ("caregiver_id", "date");

CREATE TABLE IF NOT EXISTS "route_plan_stops" (
  "id" text PRIMARY KEY NOT NULL,
  "route_plan_id" text NOT NULL REFERENCES "route_plans"("id") ON DELETE CASCADE,
  "client_id" text REFERENCES "clients"("id"),
  "stop_order" integer NOT NULL,
  "address" text,
  "latitude" numeric(10, 8),
  "longitude" numeric(11, 8),
  "arrival_time" timestamp,
  "departure_time" timestamp,
  "distance_from_prev_miles" numeric(8, 2),
  "duration_from_prev_minutes" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "route_plan_stops_route_plan_id_idx" ON "route_plan_stops" ("route_plan_id");

CREATE TABLE IF NOT EXISTS "optimizer_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "run_type" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "input_params" jsonb,
  "result_summary" jsonb,
  "error_message" text,
  "duration_ms" integer,
  "created_by_id" text REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "service_capabilities" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "category" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "caregiver_capabilities" (
  "id" text PRIMARY KEY NOT NULL,
  "caregiver_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "capability_id" text NOT NULL REFERENCES "service_capabilities"("id") ON DELETE CASCADE,
  "proficiency_level" text DEFAULT 'basic',
  "certified_date" date,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "caregiver_capabilities_caregiver_capability_idx" ON "caregiver_capabilities" ("caregiver_id", "capability_id");
CREATE INDEX IF NOT EXISTS "caregiver_capabilities_caregiver_id_idx" ON "caregiver_capabilities" ("caregiver_id");

CREATE TABLE IF NOT EXISTS "client_caregiver_restrictions" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "caregiver_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "restriction_type" text DEFAULT 'do_not_assign' NOT NULL,
  "reason" text,
  "created_by_id" text REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "client_caregiver_restrictions_pair_idx" ON "client_caregiver_restrictions" ("client_id", "caregiver_id");
CREATE INDEX IF NOT EXISTS "client_caregiver_restrictions_client_id_idx" ON "client_caregiver_restrictions" ("client_id");
CREATE INDEX IF NOT EXISTS "client_caregiver_restrictions_caregiver_id_idx" ON "client_caregiver_restrictions" ("caregiver_id");

CREATE TABLE IF NOT EXISTS "compliance_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "category" text,
  "document_url" text,
  "requires_acknowledgment" boolean DEFAULT false NOT NULL,
  "effective_date" date,
  "expiry_date" date,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_id" text REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "compliance_documents_category_idx" ON "compliance_documents" ("category");

CREATE TABLE IF NOT EXISTS "document_acknowledgments" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL REFERENCES "compliance_documents"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "acknowledged_at" timestamp DEFAULT now() NOT NULL,
  "signature_data" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "document_acknowledgments_doc_user_idx" ON "document_acknowledgments" ("document_id", "user_id");
CREATE INDEX IF NOT EXISTS "document_acknowledgments_document_id_idx" ON "document_acknowledgments" ("document_id");

CREATE TABLE IF NOT EXISTS "application_status_history" (
  "id" text PRIMARY KEY NOT NULL,
  "application_id" text NOT NULL REFERENCES "applications"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "notes" text,
  "changed_by_id" text REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "application_status_history_application_id_idx" ON "application_status_history" ("application_id");

CREATE TABLE IF NOT EXISTS "family_members" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "relationship" text,
  "email" text,
  "phone" text,
  "password_hash" text,
  "portal_token" text,
  "portal_token_exp" timestamp,
  "last_login_at" timestamp,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "family_members_client_id_idx" ON "family_members" ("client_id");
CREATE INDEX IF NOT EXISTS "family_members_email_idx" ON "family_members" ("email");

CREATE TABLE IF NOT EXISTS "family_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "family_member_id" text NOT NULL REFERENCES "family_members"("id") ON DELETE CASCADE,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "sender_type" text NOT NULL,
  "sender_name" text,
  "body" text NOT NULL,
  "is_read" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "family_messages_family_member_id_idx" ON "family_messages" ("family_member_id");
CREATE INDEX IF NOT EXISTS "family_messages_client_id_idx" ON "family_messages" ("client_id");

CREATE TABLE IF NOT EXISTS "payroll_records" (
  "id" text PRIMARY KEY NOT NULL,
  "caregiver_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "regular_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
  "overtime_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
  "holiday_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
  "regular_rate" numeric(8, 2),
  "overtime_rate" numeric(8, 2),
  "gross_pay" numeric(12, 2),
  "mileage_reimbursement" numeric(8, 2) DEFAULT '0',
  "status" text DEFAULT 'draft' NOT NULL,
  "approved_at" timestamp,
  "approved_by_id" text REFERENCES "users"("id"),
  "processed_at" timestamp,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "payroll_records_caregiver_id_idx" ON "payroll_records" ("caregiver_id");
CREATE INDEX IF NOT EXISTS "payroll_records_period_idx" ON "payroll_records" ("period_start", "period_end");
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_records_caregiver_period_idx" ON "payroll_records" ("caregiver_id", "period_start", "period_end");

CREATE TABLE IF NOT EXISTS "payroll_line_items" (
  "id" text PRIMARY KEY NOT NULL,
  "payroll_record_id" text NOT NULL REFERENCES "payroll_records"("id") ON DELETE CASCADE,
  "time_entry_id" text REFERENCES "time_entries"("id"),
  "client_id" text REFERENCES "clients"("id"),
  "date" date NOT NULL,
  "hours" numeric(6, 2) NOT NULL,
  "rate" numeric(8, 2) NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "pay_type" text DEFAULT 'regular' NOT NULL,
  "description" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "payroll_line_items_payroll_record_id_idx" ON "payroll_line_items" ("payroll_record_id");

-- Seed standard denial codes
INSERT INTO "denial_code_lookup" ("id", "code", "description", "category", "remediation") VALUES
  ('dc_co4', 'CO-4', 'Procedure code inconsistent with modifier or missing modifier', 'coding', 'Verify correct modifier is attached to procedure code'),
  ('dc_co16', 'CO-16', 'Claim lacks information needed for adjudication', 'missing_info', 'Review claim for missing required fields and resubmit'),
  ('dc_co18', 'CO-18', 'Duplicate claim/service', 'duplicate', 'Verify claim was not previously submitted; void if duplicate'),
  ('dc_co22', 'CO-22', 'Care may be covered by another payer', 'coordination', 'Check coordination of benefits; bill primary payer first'),
  ('dc_co27', 'CO-27', 'Expenses incurred after coverage terminated', 'eligibility', 'Verify member eligibility dates; check for coverage gaps'),
  ('dc_co29', 'CO-29', 'Time limit for filing has expired', 'timely_filing', 'File appeal with proof of timely submission if applicable'),
  ('dc_co45', 'CO-45', 'Exceeds fee schedule/maximum allowable', 'rate', 'Adjust billed amount to match fee schedule'),
  ('dc_co50', 'CO-50', 'Non-covered service', 'coverage', 'Verify service is covered under plan; check authorization'),
  ('dc_co96', 'CO-96', 'Non-covered charge(s)', 'coverage', 'Review coverage policy; may need prior authorization'),
  ('dc_co97', 'CO-97', 'Payment adjusted - already adjudicated', 'duplicate', 'Review prior payment history for this service date'),
  ('dc_co109', 'CO-109', 'Claim not covered by this payer', 'payer', 'Verify correct payer; reroute if needed'),
  ('dc_co197', 'CO-197', 'Precertification/authorization absent', 'authorization', 'Obtain required authorization and resubmit'),
  ('dc_oa18', 'OA-18', 'Duplicate claim/service', 'duplicate', 'Check for duplicate submissions'),
  ('dc_pr1', 'PR-1', 'Deductible amount', 'patient_resp', 'Bill patient for deductible amount'),
  ('dc_pr2', 'PR-2', 'Coinsurance amount', 'patient_resp', 'Bill patient for coinsurance portion')
ON CONFLICT ("code") DO NOTHING;
