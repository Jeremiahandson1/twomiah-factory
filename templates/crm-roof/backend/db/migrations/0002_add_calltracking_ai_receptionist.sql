-- Add Call Tracking + AI Receptionist tables
-- For existing deployments that need these features

-- Tracking Numbers
CREATE TABLE IF NOT EXISTS tracking_number (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  forward_to TEXT,
  name TEXT,
  source TEXT,
  campaign TEXT,
  medium TEXT,
  provider_id TEXT,
  provider TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS tracking_number_company_id_idx ON tracking_number(company_id);

-- Phone Call (legacy/simple tracking)
CREATE TABLE IF NOT EXISTS phone_call (
  id TEXT PRIMARY KEY,
  caller_number TEXT NOT NULL,
  status TEXT NOT NULL,
  duration INTEGER,
  recording_url TEXT,
  transcription TEXT,
  tracking_number_id TEXT NOT NULL REFERENCES tracking_number(id) ON DELETE CASCADE,
  company_id TEXT REFERENCES company(id),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS phone_call_tracking_number_id_idx ON phone_call(tracking_number_id);

-- Call Log (full attribution tracking)
CREATE TABLE IF NOT EXISTS call_log (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  tracking_number_id TEXT REFERENCES tracking_number(id),
  contact_id TEXT REFERENCES contact(id),
  caller_number TEXT,
  caller_name TEXT,
  caller_city TEXT,
  caller_state TEXT,
  source TEXT,
  campaign TEXT,
  medium TEXT,
  keyword TEXT,
  landing_page TEXT,
  direction TEXT DEFAULT 'inbound',
  duration INTEGER,
  status TEXT NOT NULL DEFAULT 'completed',
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  recording_url TEXT,
  transcription TEXT,
  tags JSONB,
  notes TEXT,
  first_time_caller BOOLEAN DEFAULT false,
  provider_id TEXT,
  is_lead BOOLEAN DEFAULT false,
  lead_value NUMERIC(12, 2),
  ai_summary TEXT,
  ai_response_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS call_log_company_id_idx ON call_log(company_id);
CREATE INDEX IF NOT EXISTS call_log_contact_id_idx ON call_log(contact_id);

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
