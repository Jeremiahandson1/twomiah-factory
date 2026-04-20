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
  website_theme   text,

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

  -- Trial tracking (30-day free trial, no credit card required)
  trial_ends_at            timestamptz,
  trial_warning_7d_sent_at timestamptz,
  trial_warning_3d_sent_at timestamptz,
  trial_warning_0d_sent_at timestamptz,
  trial_expired_at         timestamptz,

  -- Products & Features
  products        text[],
  features        text[],

  -- Deploy URLs (populated after Render deployment)
  render_frontend_url text,
  render_backend_url  text,
  website_url         text,
  ads_url             text,

  -- Supabase project (dedicated per customer)
  supabase_project_ref text,

  -- R2 media bucket (per customer)
  r2_bucket_name text,

  -- Deployed CRM database connection (for live feature sync)
  database_url    text,

  -- Factory sync key (shared secret for HTTP-based feature sync)
  factory_sync_key text,

  -- QuickBooks Desktop integration
  qb_desktop_id   text,
  qb_desktop_synced_invoices text[] default '{}',

  -- Notes
  notes           text
);

create index if not exists idx_tenants_slug on tenants(slug);
create index if not exists idx_tenants_status on tenants(status);
create index if not exists idx_tenants_billing_status on tenants(billing_status);
create index if not exists idx_tenants_billing_type on tenants(billing_type);
create index if not exists idx_tenants_billing_composite on tenants(billing_type, billing_status);
create index if not exists idx_tenants_stripe_subscription on tenants(stripe_subscription_id);
create index if not exists idx_tenants_trial_ends_at on tenants(trial_ends_at) where trial_ends_at is not null;


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


-- ─── Support Tickets ────────────────────────────────────────────────────────
-- Tickets submitted by CRM customers to Twomiah support.

create table if not exists support_tickets (
  id              uuid primary key default uuid_generate_v4(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Ticket info
  number          text not null,
  subject         text not null,
  description     text,
  status          text not null default 'open',        -- open, in_progress, waiting, resolved, closed
  priority        text not null default 'normal',      -- low, normal, high, urgent, critical
  category        text,                                -- billing, technical, feature_request, bug, general
  source          text default 'portal',               -- portal, email, ai_chat

  -- Link to tenant
  tenant_id       uuid not null references tenants(id) on delete cascade,
  submitter_email text,
  submitter_name  text,

  -- Assignment
  assigned_to     text,                                -- Factory team member email

  -- SLA tracking
  sla_response_due  timestamptz,
  sla_resolve_due   timestamptz,
  first_response_at timestamptz,
  resolved_at       timestamptz,
  closed_at         timestamptz,
  escalated_at      timestamptz,
  escalation_level  integer not null default 0,

  -- AI fields
  ai_category       text,
  ai_priority_score integer,

  -- Rating
  rating            integer,
  rating_comment    text,

  -- Metadata
  tags              text[] default '{}',
  metadata          jsonb default '{}'
);

create index if not exists idx_support_tickets_tenant on support_tickets(tenant_id);
create index if not exists idx_support_tickets_status on support_tickets(status);
create index if not exists idx_support_tickets_priority on support_tickets(priority);
create index if not exists idx_support_tickets_assigned on support_tickets(assigned_to);
create index if not exists idx_support_tickets_sla_due on support_tickets(sla_resolve_due) where status in ('open', 'in_progress');

alter table support_tickets enable row level security;
create policy "Service role full access on support_tickets"
  on support_tickets for all
  using (true)
  with check (true);


-- ─── Support Ticket Messages ────────────────────────────────────────────────

create table if not exists support_ticket_messages (
  id              uuid primary key default uuid_generate_v4(),
  created_at      timestamptz not null default now(),

  ticket_id       uuid not null references support_tickets(id) on delete cascade,
  body            text not null,
  is_internal     boolean not null default false,
  is_ai           boolean not null default false,
  sender_type     text not null default 'customer',    -- customer, agent, system
  sender_email    text,
  sender_name     text,
  attachments     jsonb default '[]'
);

create index if not exists idx_support_messages_ticket on support_ticket_messages(ticket_id);

alter table support_ticket_messages enable row level security;
create policy "Service role full access on support_ticket_messages"
  on support_ticket_messages for all
  using (true)
  with check (true);


-- ─── Support Knowledge Base (Factory-level) ─────────────────────────────────

create table if not exists support_knowledge_base (
  id              uuid primary key default uuid_generate_v4(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  title           text not null,
  content         text not null,
  category        text,
  tags            text[] default '{}',
  published       boolean not null default true,
  view_count      integer not null default 0
);

alter table support_knowledge_base enable row level security;
create policy "Service role full access on support_knowledge_base"
  on support_knowledge_base for all
  using (true)
  with check (true);


-- ─── Factory Users (RBAC) ─────────────────────────────────────────────────

create table if not exists factory_users (
  id          uuid primary key default uuid_generate_v4(),
  auth_id     uuid not null unique,
  email       text not null,
  name        text,
  role        text not null default 'viewer' check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at  timestamptz not null default now()
);

create index if not exists idx_factory_users_auth_id on factory_users(auth_id);
create index if not exists idx_factory_users_email on factory_users(email);

alter table factory_users enable row level security;
create policy "Service role full access on factory_users"
  on factory_users for all
  using (true)
  with check (true);


-- ─── Product Feedback Tracker ───────────────────────────────────────────────

create table if not exists product_feedback (
  id              uuid primary key default uuid_generate_v4(),
  created_at      timestamptz not null default now(),

  title           text not null,
  description     text,
  category        text,                                -- ux, performance, feature, bug, integration
  status          text not null default 'new',         -- new, under_review, planned, in_progress, done, wont_fix
  votes           integer not null default 1,
  source_ticket_id uuid references support_tickets(id) on delete set null,
  tenant_id       uuid references tenants(id) on delete set null
);

create index if not exists idx_product_feedback_status on product_feedback(status);
create index if not exists idx_product_feedback_category on product_feedback(category);

alter table product_feedback enable row level security;
create policy "Service role full access on product_feedback"
  on product_feedback for all
  using (true)
  with check (true);


-- ─── Tenant Feature Audit Log ─────────────────────────────────────────────

create table if not exists tenant_feature_audit (
  id              uuid primary key default uuid_generate_v4(),
  created_at      timestamptz not null default now(),

  tenant_id       uuid not null references tenants(id) on delete cascade,
  action          text not null,          -- 'enable', 'disable', 'bulk_update'
  features        text[] not null,        -- features that were changed
  previous        text[] not null,        -- full feature list before change
  current         text[] not null,        -- full feature list after change
  changed_by      text,                   -- admin email or 'system'
  synced_to_crm   boolean not null default false,
  note            text
);

create index if not exists idx_tenant_feature_audit_tenant on tenant_feature_audit(tenant_id);
create index if not exists idx_tenant_feature_audit_created on tenant_feature_audit(created_at);

alter table tenant_feature_audit enable row level security;
create policy "Service role full access on tenant_feature_audit"
  on tenant_feature_audit for all
  using (true)
  with check (true);


-- ─── Tenant Audit Log ───────────────────────────────────────────────────────
-- General audit trail for tenant modifications (status, billing, URLs, etc.)

create table if not exists tenant_audit_log (
  id          uuid primary key default uuid_generate_v4(),
  created_at  timestamptz not null default now(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  action      text not null,        -- 'update', 'status_change', 'billing_change', 'deploy', etc
  changes     jsonb not null,        -- { field: { old: x, new: y } }
  changed_by  text,                  -- admin email or 'system'
  note        text
);

create index if not exists idx_tenant_audit_log_tenant on tenant_audit_log(tenant_id);
create index if not exists idx_tenant_audit_log_created on tenant_audit_log(created_at);
create index if not exists idx_tenant_audit_log_action on tenant_audit_log(action);

alter table tenant_audit_log enable row level security;
create policy "Service role full access on tenant_audit_log"
  on tenant_audit_log for all
  using (true)
  with check (true);


-- ─── Factory Integrations ─────────────────────────────────────────────────────
-- Stores OAuth tokens and config for third-party integrations (e.g. QBO).

create table if not exists factory_integrations (
  id          text primary key,                          -- e.g. 'qbo'
  updated_at  timestamptz not null default now(),
  config      jsonb not null default '{}'                -- stores tokens, realm_id, etc.
);

alter table factory_integrations enable row level security;
create policy "Service role full access on factory_integrations"
  on factory_integrations for all
  using (true)
  with check (true);


-- ─── Factory Pricing Config ───────────────────────────────────────────────────
-- Per-product pricing configuration as JSONB.
-- Each CRM product (crm, crm-fieldservice, crm-roof, crm-homecare) gets its own row.
-- Editable from Factory admin — the /plans API reads from here.

create table if not exists factory_pricing (
  product         text primary key,                              -- e.g. 'crm', 'crm-fieldservice', 'crm-roof', 'crm-homecare'
  updated_at      timestamptz not null default now(),
  updated_by      text,

  -- All pricing data stored as structured JSONB
  saas_tiers      jsonb not null default '[]',
  self_hosted     jsonb not null default '[]',
  self_hosted_addons jsonb not null default '[]',
  deploy_services jsonb not null default '[]',
  feature_bundles jsonb not null default '[]'
);

alter table factory_pricing enable row level security;
create policy "Service role full access on factory_pricing"
  on factory_pricing for all
  using (true)
  with check (true);

-- ─── Roof Report Review Queue ──────────────────────────────────────────────
-- Tracks auto-detect roof reports pending human review.
-- The factory platform shows these in a review queue; once approved,
-- the corrected edges are pushed back to the tenant CRM.

create table if not exists roof_review_queue (
  id              uuid primary key default uuid_generate_v4(),
  report_id       text not null unique,
  company_id      uuid references tenants(id) on delete cascade,
  address         text not null default '',
  backend_url     text not null default '',
  status          text not null default 'pending',  -- pending, approved, rejected
  created_at      timestamptz not null default now(),
  approved_at     timestamptz
);

create index if not exists roof_review_queue_status_idx on roof_review_queue(status);

alter table roof_review_queue enable row level security;
create policy "Service role full access on roof_review_queue"
  on roof_review_queue for all
  using (true)
  with check (true);


-- ─── V1 Domain / Renewal / Offboard Columns ─────────────────────────────────
-- Added in Phase 1. Safe to re-run via IF NOT EXISTS.

alter table tenants add column if not exists domain_registrar text;          -- 'namecheap' | 'byod' | null
alter table tenants add column if not exists domain_expires_at timestamptz;  -- Only set when registrar='namecheap' (we only know expiry for domains we bought)
alter table tenants add column if not exists cloudflare_zone_id text;        -- Cloudflare zone created for this tenant's domain
alter table tenants add column if not exists sendgrid_domain_auth_id bigint; -- SendGrid whitelabel domain id for this tenant

-- Renewal warning sentinels (idempotent per-warning: set to now() when sent)
alter table tenants add column if not exists domain_renewal_warned_60d_at timestamptz;
alter table tenants add column if not exists domain_renewal_warned_30d_at timestamptz;
alter table tenants add column if not exists domain_renewal_warned_7d_at timestamptz;
alter table tenants add column if not exists sub_renewal_warned_60d_at timestamptz;
alter table tenants add column if not exists sub_renewal_warned_30d_at timestamptz;
alter table tenants add column if not exists sub_renewal_warned_7d_at timestamptz;

-- Offboard lifecycle
alter table tenants add column if not exists offboard_started_at timestamptz;
alter table tenants add column if not exists offboard_grace_ends_at timestamptz;
alter table tenants add column if not exists epp_code_sent_at timestamptz;

create index if not exists tenants_domain_expires_idx on tenants(domain_expires_at) where domain_expires_at is not null;
create index if not exists tenants_offboard_grace_idx on tenants(offboard_grace_ends_at) where offboard_grace_ends_at is not null;
