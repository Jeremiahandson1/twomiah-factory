-- Twomiah Factory — Supabase Schema
-- Run this in your Supabase SQL Editor to create the required tables.
-- These tables power the Factory platform (apps/api + apps/platform).

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ─── Tenants ─────────────────────────────────────────────────────────────────
-- Each tenant represents a customer whose software is provisioned by Factory.

create table if not exists tenants (
  id              uuid primary key default uuid_generate_v4(),
  created_at      timestamptz not null default now(),

  -- Identity
  name            text not null,
  slug            text not null unique,
  email           text,
  admin_email     text,
  phone           text,
  industry        text,

  -- Location
  address         text,
  city            text,
  state           text,
  zip             text,
  domain          text,

  -- Admin
  admin_password  text,
  status          text not null default 'pending',
  deployment_model text not null default 'saas',

  -- Branding
  primary_color   text default '#2563eb',
  secondary_color text default '#1e40af',

  -- Plan & Billing
  plan            text default 'starter',
  billing_type    text,
  billing_status  text,
  monthly_amount  numeric,
  one_time_amount numeric,
  paid_at         timestamptz,
  next_billing_date timestamptz,

  -- Stripe
  stripe_customer_id     text,
  stripe_subscription_id text,

  -- Products & Features
  products        text[],
  features        text[],

  -- Deploy URLs (populated after Render deployment)
  render_frontend_url text,
  render_backend_url  text,
  website_url         text,

  -- Notes
  notes           text
);

create index if not exists idx_tenants_slug on tenants(slug);
create index if not exists idx_tenants_status on tenants(status);
create index if not exists idx_tenants_billing_status on tenants(billing_status);
create index if not exists idx_tenants_stripe_subscription on tenants(stripe_subscription_id);


-- ─── Factory Jobs ────────────────────────────────────────────────────────────
-- Each job represents a build generation + optional deployment.

create table if not exists factory_jobs (
  id              uuid primary key default uuid_generate_v4(),
  created_at      timestamptz not null default now(),

  -- Link to tenant
  tenant_id       uuid not null references tenants(id) on delete cascade,

  -- Build info
  build_id        uuid unique,
  template        text,
  deployment_model text default 'owned',
  status          text not null default 'pending',

  -- Generated output
  zip_name        text,
  storage_key     text,
  storage_type    text default 'local',

  -- Config snapshot (full wizard config for regeneration)
  config          jsonb,

  -- Features & branding snapshot
  features        text[],
  branding        jsonb,

  -- Deploy results
  github_repo     text,
  render_url      text,
  render_service_ids jsonb
);

create index if not exists idx_factory_jobs_tenant on factory_jobs(tenant_id);
create index if not exists idx_factory_jobs_build_id on factory_jobs(build_id);
create index if not exists idx_factory_jobs_status on factory_jobs(status);


-- ─── Row Level Security ──────────────────────────────────────────────────────
-- The API uses service_role key, so RLS is bypassed. Enable RLS but allow
-- service_role full access. Adjust if you want per-user access controls.

alter table tenants enable row level security;
alter table factory_jobs enable row level security;

-- Allow service_role full access (used by the API)
create policy "Service role full access on tenants"
  on tenants for all
  using (true)
  with check (true);

create policy "Service role full access on factory_jobs"
  on factory_jobs for all
  using (true)
  with check (true);
