-- Construction tier compliance features: AIA G702/G703 forms.
--
-- NOTE: draw_schedule and draw_request tables already exist from migration
-- 0000 (as schedule_of_values + draw_request with schedule_of_values_id).
-- Do NOT recreate them here — the original schema is correct.

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
