-- Add SaaS subscription tables for contractor-level billing.
-- These are separate from the existing invoices table which handles per-customer
-- billing. The subscription tables track the CONTRACTOR's own Twomiah Roof
-- plan (Starter/Pro/Business/Storm/Enterprise).
--
-- Ported from crm/backend/db/migrations/0000_daily_valkyrie.sql.

CREATE TABLE IF NOT EXISTS "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"package_id" text NOT NULL,
	"billing_cycle" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"user_count" integer DEFAULT 1 NOT NULL,
	"base_price" numeric(10, 2) NOT NULL,
	"total_price" numeric(10, 2) NOT NULL,
	"features" json DEFAULT '[]'::json NOT NULL,
	"addons" json,
	"trial_ends_at" timestamp,
	"current_period_start" timestamp NOT NULL,
	"current_period_end" timestamp NOT NULL,
	"canceled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_company_id_unique" UNIQUE("company_id"),
	CONSTRAINT "subscription_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);

CREATE TABLE IF NOT EXISTS "addon_purchase" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"addon_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"stripe_payment_id" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "usage_record" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"type" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"metadata" json,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "billing_invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"line_items" json NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"tax" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_date" timestamp NOT NULL,
	"paid_at" timestamp,
	"stripe_invoice_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoice_number_unique" UNIQUE("number")
);

-- Add the lifetime_access column the SaaS billing service expects on the
-- company table. enabled_features already exists in roof's schema.
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "lifetime_access" boolean DEFAULT false NOT NULL;

-- Indexes for frequent lookups
CREATE INDEX IF NOT EXISTS "subscription_company_id_idx" ON "subscription" ("company_id");
CREATE INDEX IF NOT EXISTS "subscription_status_idx" ON "subscription" ("status");
CREATE INDEX IF NOT EXISTS "addon_purchase_company_id_idx" ON "addon_purchase" ("company_id");
CREATE INDEX IF NOT EXISTS "usage_record_company_id_idx" ON "usage_record" ("company_id");
CREATE INDEX IF NOT EXISTS "usage_record_type_idx" ON "usage_record" ("type");
CREATE INDEX IF NOT EXISTS "billing_invoice_company_id_idx" ON "billing_invoice" ("company_id");
