-- Review requests (review_request) + submitted reviews (review) tables,
-- plus financing_application table for consumer financing (Wisetack /
-- GreenSky / Sunlight). Closes the gap between Roof's marketing and
-- implementation without adding external API dependencies.

-- ═══════════════════════════════════════════════════
-- REVIEW REQUESTS & REVIEWS
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "review_request" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"job_id" text,
	"status" text DEFAULT 'pending' NOT NULL, -- pending, sent, clicked, completed, failed
	"channel" text DEFAULT 'both' NOT NULL, -- sms, email, both
	"review_link" text,
	"message" text,
	"sent_at" timestamp,
	"clicked_at" timestamp,
	"follow_up_sent_at" timestamp,
	"opened_at" timestamp,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "review_request_company_id_idx" ON "review_request" ("company_id");
CREATE INDEX IF NOT EXISTS "review_request_status_idx" ON "review_request" ("status");

CREATE TABLE IF NOT EXISTS "review" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"request_id" text,
	"contact_id" text,
	"job_id" text,
	"rating" integer NOT NULL,
	"comment" text,
	"platform" text DEFAULT 'google' NOT NULL, -- google, facebook, yelp, internal
	"reviewer_name" text,
	"verified" boolean DEFAULT false NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "review_company_id_idx" ON "review" ("company_id");

-- ═══════════════════════════════════════════════════
-- FINANCING APPLICATIONS (Wisetack / GreenSky / Sunlight)
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "financing_application" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"job_id" text,
	"quote_id" text,
	"lender" text DEFAULT 'wisetack' NOT NULL, -- wisetack, greensky, sunlight, other
	"amount_requested" numeric(12, 2) NOT NULL,
	"amount_approved" numeric(12, 2),
	"term_months" integer,
	"apr" numeric(5, 2),
	"monthly_payment" numeric(10, 2),
	"status" text DEFAULT 'pending' NOT NULL, -- pending, sent, approved, declined, funded, expired
	"application_url" text,
	"lender_reference" text, -- external lender's application ID
	"sent_at" timestamp,
	"approved_at" timestamp,
	"funded_at" timestamp,
	"expires_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "financing_application_company_id_idx" ON "financing_application" ("company_id");
CREATE INDEX IF NOT EXISTS "financing_application_contact_id_idx" ON "financing_application" ("contact_id");
CREATE INDEX IF NOT EXISTS "financing_application_status_idx" ON "financing_application" ("status");
