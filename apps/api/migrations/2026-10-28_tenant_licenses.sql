-- The own-it licence (services/ownItLicense.ts): a business buys the software outright from Settings › Billing in its own
-- app, and on payment the Factory hands over — a read-only GitHub invitation to its repo and a full data export. One row per
-- Stripe checkout session (so a redelivered webhook never records or hands over twice); each handover step is kept on the
-- row, so a failed one is retried. A licence is a right to RUN the software, not to resell it (Terms §7).
-- Run once against the Factory Supabase (SQL editor). Idempotent — safe to run again.
create table if not exists tenant_licenses (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  stripe_session_id     text not null unique,
  stripe_payment_intent text,
  amount_cents          integer not null,
  monthly_cents         integer not null,           -- the monthly list price the amount was 36x of
  months                integer not null default 36,
  plan                  text,
  github_username       text not null,
  repo                  text not null,              -- org/name
  terms_version         text not null,              -- the words shown before payment
  paid_at               timestamptz not null default now(),
  repo_invited_at       timestamptz,
  repo_invite_note      text,
  export_sent_at        timestamptz,
  export_note           text,
  handover_status       text not null default 'paid',  -- paid | complete | needs_attention
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists tenant_licenses_tenant_idx on tenant_licenses(tenant_id);
-- Tables made in the SQL editor carry no service_role privileges in this project (42501 at runtime otherwise).
grant select, insert, update, delete on table tenant_licenses to service_role;
