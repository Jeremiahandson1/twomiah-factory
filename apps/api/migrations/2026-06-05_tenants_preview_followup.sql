-- Sentinel for the 24h follow-up nudge on premium previews. When a
-- customer submits intake → composer auto-fires → preview goes live but
-- they never click "Approve & buy", we'd like to send one polite check-in
-- email a day later. This column tracks "have we already nudged" so the
-- cron is idempotent.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS preview_followup_sent_at timestamptz;
