-- Staff-only access to `tenants` and `factory_jobs` (security review S5-1, 2026-11-13).
-- Run once in the Factory Supabase (SQL editor). Safe to run again.
--
-- Why: both tables had row-level security ON with one policy each, named "Service role full access" — but the policy
-- named no role, and a policy with no role applies to EVERY role, the public key included. That key is in the staff
-- dashboard's page, so anyone could read (and write) every tenant row: database_url, factory_sync_key, admin_password.
-- The Factory's server uses the service role, which RLS does not affect; the dashboard uses a signed-in person's
-- token, so the policies below are for signed-in staff (owner, admin, editor). A sign-in with no staff row gets nothing.
--
-- Also do, in the dashboard: Authentication › Sign In / Providers › "Allow new users to sign up" OFF.
-- And afterwards: rotate what the table held (each tenant's database password and factory_sync_key).

create or replace function public.is_factory_staff(roles text[])
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from factory_users where auth_id = auth.uid() and role = any(roles))
$$;
revoke all on function public.is_factory_staff(text[]) from public, anon;
grant execute on function public.is_factory_staff(text[]) to authenticated;

drop policy if exists "Service role full access on tenants" on tenants;
drop policy if exists "Service role full access on factory_jobs" on factory_jobs;
drop policy if exists "Factory staff on tenants" on tenants;
drop policy if exists "Factory staff on factory_jobs" on factory_jobs;

create policy "Factory staff on tenants" on tenants for all to authenticated
  using (public.is_factory_staff(array['owner','admin','editor']))
  with check (public.is_factory_staff(array['owner','admin']));

create policy "Factory staff on factory_jobs" on factory_jobs for all to authenticated
  using (public.is_factory_staff(array['owner','admin','editor']))
  with check (public.is_factory_staff(array['owner','admin','editor']));

-- Check 1: this should return no rows (no policy left that names no role).
select tablename, policyname, roles, qual from pg_policies where schemaname = 'public' and roles = '{public}' order by 1;
-- Check 2: every staff sign-in, to look over for anyone unknown.
select email, role, created_at from factory_users order by created_at;
