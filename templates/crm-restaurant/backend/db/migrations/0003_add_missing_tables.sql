-- Add missing portal columns to contact table
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "portal_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "portal_token" text;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "portal_token_exp" timestamp;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "last_portal_visit" timestamp;

-- Create quickbooks_connection table
CREATE TABLE IF NOT EXISTS "quickbooks_connection" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "access_token" text,
  "refresh_token" text,
  "realm_id" text,
  "is_connected" boolean DEFAULT false NOT NULL,
  "last_sync_at" timestamp,
  "expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "quickbooks_connection_company_id_unique" UNIQUE ("company_id")
);

CREATE INDEX IF NOT EXISTS "qb_connection_company_id_idx" ON "quickbooks_connection" ("company_id");

-- Add missing columns to call_log table
ALTER TABLE "call_log" ADD COLUMN IF NOT EXISTS "source" text;
ALTER TABLE "call_log" ADD COLUMN IF NOT EXISTS "campaign" text;
ALTER TABLE "call_log" ADD COLUMN IF NOT EXISTS "medium" text;
ALTER TABLE "call_log" ADD COLUMN IF NOT EXISTS "keyword" text;
ALTER TABLE "call_log" ADD COLUMN IF NOT EXISTS "landing_page" text;
ALTER TABLE "call_log" ADD COLUMN IF NOT EXISTS "direction" text DEFAULT 'inbound';
ALTER TABLE "call_log" ADD COLUMN IF NOT EXISTS "start_time" timestamp;
ALTER TABLE "call_log" ADD COLUMN IF NOT EXISTS "end_time" timestamp;
ALTER TABLE "call_log" ADD COLUMN IF NOT EXISTS "transcription" text;
ALTER TABLE "call_log" ADD COLUMN IF NOT EXISTS "tags" json;
ALTER TABLE "call_log" ADD COLUMN IF NOT EXISTS "first_time_caller" boolean DEFAULT false;
ALTER TABLE "call_log" ADD COLUMN IF NOT EXISTS "provider_id" text;
ALTER TABLE "call_log" ADD COLUMN IF NOT EXISTS "is_lead" boolean DEFAULT false;
ALTER TABLE "call_log" ADD COLUMN IF NOT EXISTS "lead_value" numeric(12, 2);

-- Add missing columns to tracking_number table
ALTER TABLE "tracking_number" ADD COLUMN IF NOT EXISTS "campaign" text;
ALTER TABLE "tracking_number" ADD COLUMN IF NOT EXISTS "medium" text;
ALTER TABLE "tracking_number" ADD COLUMN IF NOT EXISTS "provider_id" text;
ALTER TABLE "tracking_number" ADD COLUMN IF NOT EXISTS "provider" text;
ALTER TABLE "tracking_number" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();
-- Make forward_to nullable (service passes null)
ALTER TABLE "tracking_number" ALTER COLUMN "forward_to" DROP NOT NULL;
