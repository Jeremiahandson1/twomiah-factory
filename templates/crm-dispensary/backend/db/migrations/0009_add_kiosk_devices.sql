-- Kiosk devices — a credential per tablet, so the kiosk API stops being open to anyone with the hostname.
-- A manager adds a kiosk in Settings and gets a one-time pairing code; the tablet is paired once and keeps a
-- token of its own. Per device rather than per shop, because that is what makes "this tablet walked out of
-- the building" a one-click revoke instead of a fleet-wide key rotation. (Dispensary T21 B1)
CREATE TABLE IF NOT EXISTS kiosk_devices (
  id            text PRIMARY KEY,
  company_id    text NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  location_id   text,
  name          text NOT NULL,
  -- The token is stored as a SHA-256 hash: a leaked database row must not hand anyone a working kiosk. The
  -- last four characters are kept in the clear so a manager can tell two devices apart on screen.
  token_hash    text,
  token_last4   text,
  -- One-time pairing code, shown once when the kiosk is added and useless after it is claimed or expires.
  pairing_code  text,
  pairing_expires_at timestamp,
  status        text NOT NULL DEFAULT 'pending',   -- pending | active | revoked
  last_seen_at  timestamp,
  paired_at     timestamp,
  revoked_at    timestamp,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kiosk_device_company_idx ON kiosk_devices(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS kiosk_device_token_idx ON kiosk_devices(token_hash) WHERE token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS kiosk_device_pairing_idx ON kiosk_devices(pairing_code) WHERE pairing_code IS NOT NULL;

-- Which device took an order, so the log can answer "which tablet" and not just "a kiosk".
ALTER TABLE kiosk_sessions ADD COLUMN IF NOT EXISTS kiosk_device_id text;
