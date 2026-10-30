-- The $19 "Web presence" plan (cloud/web-presence): one row per customer's Netlify site. Run once against the Factory Supabase
-- (SQL editor). Idempotent. Built SWITCHED OFF (WEB_PRESENCE_ON): the table can exist long before anything writes to it.
--
-- This holds where the site IS and what state it is in. It does NOT hold the owner's content, their leads or their applicants:
-- the content is the site's own Netlify Blobs, and a form's messages are emailed to the owner (nothing is stored by Twomiah).
create table if not exists web_presence_sites (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null unique references tenants(id) on delete cascade,
  netlify_site_id  text unique,
  netlify_site_name text,
  status           text not null default 'creating'
                   check (status in ('creating', 'live', 'failed', 'canceling', 'upgrading', 'removed')),
  origin           text,                        -- https://<name>.netlify.app
  custom_domain    text,
  ssl_ok           boolean not null default false,
  cancel_at        timestamptz,                 -- the end of the paid period, once the owner has cancelled
  last_link_at     timestamptz,                 -- the last sign-in link made (one a minute)
  upgrade_tenant_id uuid,                       -- the full-plan business built from this site's content, while it is being made
  previous_subscription_id text,                -- the $19 subscription, ended with the paid period once an upgrade is live
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists web_presence_sites_status_idx on web_presence_sites(status);

-- Row-level security ON with no policy: only the service role (the Factory's server) reads or writes this table. The staff
-- dashboard runs Supabase's PUBLIC key in the browser; a table without RLS would be open to anyone holding it.
alter table web_presence_sites enable row level security;
