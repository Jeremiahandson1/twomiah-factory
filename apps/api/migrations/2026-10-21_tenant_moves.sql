-- A business moving from the templates to the unified app (apps/api/src/unified/move.ts): one row per move.
-- The new service, database and repo are recorded HERE while the business still runs on the templates — not as a
-- factory_jobs row, which every "latest job" reader (Redeploy, Update Code, the owner lookup) would then take for the
-- business's live build. services/resourceOwnership.ts reads these rows too, so the new resources are the tenant's own
-- (never someone else's to refuse, and torn down with the tenant). At the switch the move writes the factory_jobs row.
-- Run once against the Factory Supabase (SQL editor). Idempotent — safe to run again.
create table if not exists tenant_moves (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  -- preparing → ready → (rehearsed) → moving → moved → switched; or failed / rolled_back
  status             text not null default 'preparing',
  kind               text not null,            -- the old CRM template: crm | crm-bar | homecare
  vertical           text not null,            -- the unified vertical (apps/unified/verticals)
  site               text not null,            -- fresh | premium | none
  old_resources      jsonb not null default '{}', -- the template services and database, and the tenant row's values before the switch
  render_service_ids jsonb,                    -- { backend, database } of the NEW service (resourceOwnership reads it)
  github_repo        text,
  render_url         text,
  reports            jsonb not null default '[]', -- each step's report, newest last
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists tenant_moves_tenant_idx on tenant_moves(tenant_id);
-- Tables made in the SQL editor carry no service_role privileges in this project (42501 at runtime otherwise).
grant select, insert, update, delete on table tenant_moves to service_role;
