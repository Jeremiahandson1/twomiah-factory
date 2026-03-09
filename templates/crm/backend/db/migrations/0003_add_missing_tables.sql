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
