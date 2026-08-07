-- Tenant health monitor (item 13).
--
-- Latest health result per tenant, written by the daily lifecycle cron
-- (/internal/health-sweep). One row per tenant rather than a history table —
-- the operator's question is "is anything broken right now", and a history
-- table nobody reads is just disk.
--
-- health_status:     healthy | degraded | down
-- health_detail:     the individual checks and why they failed
-- health_alerted_at: throttles staff alerts to the transition into unhealthy
--                    plus one reminder per day while it stays down
--
-- Additive and idempotent — safe to run more than once.

alter table tenants add column if not exists health_status text;
alter table tenants add column if not exists health_checked_at timestamptz;
alter table tenants add column if not exists health_detail jsonb;
alter table tenants add column if not exists health_alerted_at timestamptz;

create index if not exists idx_tenants_health_status on tenants(health_status);
