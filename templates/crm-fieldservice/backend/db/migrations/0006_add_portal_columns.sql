-- Add columns defined in schema.ts but missing from prior migrations.
-- Covers portal, QuickBooks sync, SMS, job/quote/invoice relations,
-- equipment relations, and company integrations.

-- CONTACT table
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "portal_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "portal_token" text;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "portal_token_exp" timestamp;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "last_portal_visit" timestamp;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "qb_customer_id" text;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "opted_out_sms" boolean DEFAULT false;

-- JOB table
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "job_type" text;
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "equipment_id" text;
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "site_id" text;
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "service_agreement_id" text;

-- QUOTE table
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "customer_message" text;
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "converted_to_job_id" text;
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "declined_at" timestamp;
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "equipment_id" text;
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "site_id" text;

-- INVOICE table
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "qb_invoice_id" text;
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "synced_at" timestamp;

-- EQUIPMENT table
ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "contact_id" text;
ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "location_id" text;
ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "site_id" text;

-- COMPANY table
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "lifetime_access" boolean DEFAULT false;
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "twilio_phone_number" text;
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "twilio_account_sid" text;
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "twilio_auth_token" text;
