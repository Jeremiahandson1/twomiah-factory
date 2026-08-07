-- Status page incidents (item 17).
--
-- Component states on the status page are measured live (API, database,
-- provisioning, email, payments, and the tenant fleet's health sweep). This
-- table is the human half: what we are telling customers about a problem, and
-- the record of what happened afterwards.
--
-- component: 'api' | 'database' | 'provisioning' | 'email' | 'payments'
--            | 'tenants' | 'other'   (free text; the page groups by it)
-- impact:    'degraded' | 'down' | 'maintenance'
-- resolved_at: null while open. An open incident forces its component to at
--              least the incident's impact on the public page, so a known
--              problem is never hidden behind a green tick.
--
-- Additive and idempotent — safe to run more than once.

create table if not exists status_incidents (
  id           uuid primary key default uuid_generate_v4(),
  component    text not null,
  impact       text not null default 'degraded',
  title        text not null,
  body         text,
  started_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_status_incidents_open
  on status_incidents(resolved_at, started_at desc);
