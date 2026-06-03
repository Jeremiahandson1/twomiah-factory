CREATE TABLE IF NOT EXISTS "lead_source" (
  "id" text PRIMARY KEY NOT NULL,
  "platform" text NOT NULL,
  "label" text NOT NULL,
  "inbound_email" text,
  "webhook_url" text,
  "webhook_secret" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "config" json DEFAULT '{}'::json NOT NULL,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "lead" (
  "id" text PRIMARY KEY NOT NULL,
  "source_platform" text NOT NULL,
  "source_id" text REFERENCES "lead_source"("id") ON DELETE SET NULL,
  "homeowner_name" text NOT NULL,
  "email" text,
  "phone" text,
  "job_type" text,
  "location" text,
  "budget" text,
  "description" text,
  "status" text DEFAULT 'new' NOT NULL,
  "raw_payload" json,
  "converted_contact_id" text REFERENCES "contact"("id") ON DELETE SET NULL,
  "contacted_at" timestamp,
  "received_at" timestamp DEFAULT now() NOT NULL,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "lead_source_company_id_idx" ON "lead_source" ("company_id");
CREATE INDEX IF NOT EXISTS "lead_source_platform_idx" ON "lead_source" ("platform");
CREATE INDEX IF NOT EXISTS "lead_company_id_idx" ON "lead" ("company_id");
CREATE INDEX IF NOT EXISTS "lead_status_idx" ON "lead" ("status");
CREATE INDEX IF NOT EXISTS "lead_source_platform_idx2" ON "lead" ("source_platform");
CREATE INDEX IF NOT EXISTS "lead_received_at_idx" ON "lead" ("received_at");
