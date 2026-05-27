-- Adds intake_data column to tenants for storing local-business website
-- intake submissions (logo storage key, photo storage keys, brand notes,
-- free-form notes, etc.) without polluting the plain-text notes column.
-- Consumed by POST /api/v1/factory/public/intake.
--
-- Run on the live Supabase DB before deploying the new endpoint, or the
-- insert will fail with 42703 (undefined column).

alter table tenants
  add column if not exists intake_data jsonb;

-- Partial index so the platform dashboard can cheaply list intakes
-- separately from active/pending/churned tenants.
create index if not exists idx_tenants_status_intake
  on tenants(created_at desc)
  where status = 'intake';
