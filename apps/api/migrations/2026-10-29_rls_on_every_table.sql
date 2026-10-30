-- Row-level security ON for every Factory table that was created without it (found 2026-10-29, reviewing the Web presence round).
-- Run once in the Factory Supabase (SQL editor). Idempotent: enabling RLS on a table that already has it changes nothing.
--
-- Why: the staff dashboard (apps/platform) runs Supabase's PUBLIC key in the browser, and a public-schema table without RLS is
-- open through Supabase's REST API to anyone holding that key. The dashboard reads only `tenants` and `factory_jobs` directly
-- (both already have RLS); these tables are used by the Factory's server alone, through the service role, which RLS does not
-- affect — so turning it on with no policy locks the public key out and changes nothing for the Factory.
alter table if exists intake_feedback    enable row level security;
alter table if exists messaging_ledger   enable row level security;
alter table if exists status_incidents   enable row level security;
alter table if exists tenant_licenses    enable row level security;
alter table if exists tenant_moves       enable row level security;
alter table if exists web_presence_sites enable row level security;

-- Check: this should now return no rows (every public table has RLS on).
select tablename from pg_tables where schemaname = 'public' and rowsecurity = false order by 1;
