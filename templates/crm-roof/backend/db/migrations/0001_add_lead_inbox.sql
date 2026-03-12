-- Lead Inbox tables for crm-roof
-- Run against existing deployments to add lead inbox functionality

CREATE TABLE IF NOT EXISTS lead_source (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  label TEXT NOT NULL,
  inbound_email TEXT,
  webhook_url TEXT,
  webhook_secret TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}',
  company_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_source_company_id_idx ON lead_source(company_id);
CREATE INDEX IF NOT EXISTS lead_source_platform_idx ON lead_source(platform);

CREATE TABLE IF NOT EXISTS lead (
  id TEXT PRIMARY KEY,
  source_platform TEXT NOT NULL,
  source_id TEXT REFERENCES lead_source(id) ON DELETE SET NULL,
  homeowner_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  job_type TEXT,
  location TEXT,
  budget TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  raw_payload JSONB,
  converted_contact_id TEXT REFERENCES contact(id) ON DELETE SET NULL,
  contacted_at TIMESTAMP,
  received_at TIMESTAMP NOT NULL DEFAULT NOW(),
  company_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_company_id_idx ON lead(company_id);
CREATE INDEX IF NOT EXISTS lead_status_idx ON lead(status);
CREATE INDEX IF NOT EXISTS lead_platform_idx ON lead(source_platform);
CREATE INDEX IF NOT EXISTS lead_received_at_idx ON lead(received_at);
