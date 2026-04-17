CREATE TABLE IF NOT EXISTS provider_integration (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  client_id TEXT,
  client_secret TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  realm_id TEXT,
  webhook_secret TEXT,
  connected BOOLEAN DEFAULT false NOT NULL,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS provider_integration_company_id_idx ON provider_integration(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS provider_integration_company_provider_uniq ON provider_integration(company_id, provider);

ALTER TABLE measurement_report ADD COLUMN IF NOT EXISTS external_provider TEXT;
ALTER TABLE measurement_report ADD COLUMN IF NOT EXISTS external_order_id TEXT;
ALTER TABLE measurement_report ADD COLUMN IF NOT EXISTS external_status TEXT;
