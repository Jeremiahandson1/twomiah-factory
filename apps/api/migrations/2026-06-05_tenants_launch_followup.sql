-- Sentinel for the post-launch tips email. Sent ~24-72h after the
-- tenant paid (stripe_subscription_id set + paid_at within window).
-- Single shot; preview_followup uses the same pattern.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS launch_followup_sent_at timestamptz;
