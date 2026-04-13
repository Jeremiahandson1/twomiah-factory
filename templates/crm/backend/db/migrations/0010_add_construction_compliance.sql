-- Construction tier compliance features: draw schedules, draw requests,
-- AIA G702/G703 forms. Also indexes for existing lien_waiver and submittal
-- tables (the schemas were defined but never had routes until now).
--
-- Paired with: routes/drawSchedules.ts, routes/aiaForms.ts,
-- routes/submittals.ts, routes/lienWaivers.ts (new in this session).

-- ═══════════════════════════════════════════════════
-- DRAW SCHEDULES — construction loan draw schedule tracking
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "draw_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"lender_name" text,
	"lender_contact" text,
	"status" text DEFAULT 'active' NOT NULL, -- active, completed, cancelled
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "draw_schedule_company_id_idx" ON "draw_schedule" ("company_id");
CREATE INDEX IF NOT EXISTS "draw_schedule_project_id_idx" ON "draw_schedule" ("project_id");

-- Individual draw request against a draw schedule
CREATE TABLE IF NOT EXISTS "draw_request" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"draw_schedule_id" text NOT NULL,
	"draw_number" integer NOT NULL,
	"amount_requested" numeric(12, 2) NOT NULL,
	"amount_approved" numeric(12, 2),
	"percent_complete" numeric(5, 2),
	"status" text DEFAULT 'pending' NOT NULL, -- pending, submitted, approved, paid, rejected
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp,
	"approved_at" timestamp,
	"paid_at" timestamp,
	"notes" text,
	"inspection_photos" json,
	"supporting_docs" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "draw_request_company_id_idx" ON "draw_request" ("company_id");
CREATE INDEX IF NOT EXISTS "draw_request_schedule_id_idx" ON "draw_request" ("draw_schedule_id");

-- ═══════════════════════════════════════════════════
-- AIA FORMS — G702 (Application for Payment) and G703 (Continuation Sheet)
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "aia_form" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"form_type" text NOT NULL, -- 'G702' or 'G703'
	"application_number" integer NOT NULL,
	"period_to" timestamp NOT NULL,
	"contract_sum" numeric(12, 2) NOT NULL,
	"net_change_by_change_orders" numeric(12, 2) DEFAULT '0' NOT NULL,
	"contract_sum_to_date" numeric(12, 2) NOT NULL,
	"total_completed_and_stored" numeric(12, 2) NOT NULL,
	"retainage_percent" numeric(5, 2) DEFAULT '10' NOT NULL,
	"retainage_amount" numeric(12, 2) NOT NULL,
	"total_earned_less_retainage" numeric(12, 2) NOT NULL,
	"less_previous_certificates" numeric(12, 2) DEFAULT '0' NOT NULL,
	"current_payment_due" numeric(12, 2) NOT NULL,
	"balance_to_finish" numeric(12, 2) NOT NULL,
	"line_items" json NOT NULL, -- for G703 continuation sheet rows
	"status" text DEFAULT 'draft' NOT NULL, -- draft, signed, submitted, paid
	"signed_by" text,
	"signed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "aia_form_company_id_idx" ON "aia_form" ("company_id");
CREATE INDEX IF NOT EXISTS "aia_form_project_id_idx" ON "aia_form" ("project_id");
CREATE UNIQUE INDEX IF NOT EXISTS "aia_form_project_app_unique"
	ON "aia_form" ("project_id", "form_type", "application_number");
