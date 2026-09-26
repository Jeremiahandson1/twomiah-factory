-- Add AI Receptionist tables and call_log AI columns
-- For existing deployments that need the AI receptionist feature

-- AI columns on call_log (skip if already present)
ALTER TABLE call_log ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE call_log ADD COLUMN IF NOT EXISTS ai_response_sent BOOLEAN DEFAULT false;

-- AI Receptionist Rules
CREATE TABLE IF NOT EXISTS ai_receptionist_rule (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  channel TEXT NOT NULL,
  message_template TEXT NOT NULL,
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  keyword_match TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_receptionist_rule_company_id_idx ON ai_receptionist_rule(company_id);

-- AI Receptionist Settings
CREATE TABLE IF NOT EXISTS ai_receptionist_settings (
  company_id TEXT PRIMARY KEY REFERENCES company(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  business_hours_start TEXT NOT NULL DEFAULT '09:00',
  business_hours_end TEXT NOT NULL DEFAULT '17:00',
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  greeting_text TEXT,
  forwarding_number TEXT,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);
