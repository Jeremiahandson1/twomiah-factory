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

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS kiosk_device_company_idx ON kiosk_devices(company_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS kiosk_device_token_idx ON kiosk_devices(token_hash) WHERE token_hash IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS kiosk_device_pairing_idx ON kiosk_devices(pairing_code) WHERE pairing_code IS NOT NULL;
--> statement-breakpoint
-- Which device took an order, so the log can answer "which tablet" and not just "a kiosk".
--
-- GUARDED, AND SEPARATED. (T58d)
--
-- Two things were wrong with this file and both were invisible. It had no statement separators at
-- all, so every statement in it was one string; and it ends by altering `kiosk_sessions`, a table
-- that db/schema.ts declares and NO migration creates. On a database built from the migration
-- history alone — which is every brand-new tenant, because migrate runs before
-- `drizzle-kit push --force` — this threw `relation "kiosk_sessions" does not exist`, took the whole
-- file down with it including kiosk_devices, and stopped migration 0009 and everything after it from
-- ever applying. The tenant still came up, because push then built the schema from schema.ts, so
-- nothing ever reported it. The nine tenants that exist today all say "[migrate] Success": they
-- applied this long ago, when a previous boot's push had already made the table. It was only ever
-- the NEXT dispensary tenant that would have been stuck at 0008 for ever.
--
-- schema.ts already declares kiosk_sessions.kiosk_device_id, so on any pushed database this ALTER is
-- a no-op; the guard is there so a migration-only database can get past it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'kiosk_sessions') THEN
    ALTER TABLE kiosk_sessions ADD COLUMN IF NOT EXISTS kiosk_device_id text;
  END IF;
END $$;
