-- Debounce timestamp for the low-balance top-up nudge email, so a tenant isn't
-- emailed repeatedly. Cleared on top-up so a future low balance re-nudges.
-- Apply manually on the live Supabase DB before deploying.

alter table tenants
  add column if not exists messaging_nudged_at timestamptz;
