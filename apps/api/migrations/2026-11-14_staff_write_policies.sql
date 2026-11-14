-- Who may DELETE a business's row (security review, 2026-11-14). Run once in the Factory Supabase (SQL editor). Safe to run again.
--
-- Why: 2026-11-13_staff_only_policies.sql gave `tenants` and `factory_jobs` one policy each, `for all`, with
--   using      (owner, admin, editor)     -- which rows a person may see, change or delete
--   with check (owner, admin)             -- what a NEW or CHANGED row must satisfy
-- A delete has no new row, so `with check` never applies to it: an EDITOR could delete any business's row (and its
-- build records) straight from the dashboard's database connection, although every Factory route that removes or
-- changes a business asks for owner or admin. One policy per action says it plainly: editors read; owners and admins write.

drop policy if exists "Factory staff on tenants" on tenants;
drop policy if exists "Factory staff read tenants" on tenants;
drop policy if exists "Factory staff insert tenants" on tenants;
drop policy if exists "Factory staff update tenants" on tenants;
drop policy if exists "Factory staff delete tenants" on tenants;

create policy "Factory staff read tenants" on tenants for select to authenticated
  using (public.is_factory_staff(array['owner','admin','editor']));
create policy "Factory staff insert tenants" on tenants for insert to authenticated
  with check (public.is_factory_staff(array['owner','admin']));
create policy "Factory staff update tenants" on tenants for update to authenticated
  using (public.is_factory_staff(array['owner','admin']))
  with check (public.is_factory_staff(array['owner','admin']));
create policy "Factory staff delete tenants" on tenants for delete to authenticated
  using (public.is_factory_staff(array['owner','admin']));

drop policy if exists "Factory staff on factory_jobs" on factory_jobs;
drop policy if exists "Factory staff read factory_jobs" on factory_jobs;
drop policy if exists "Factory staff insert factory_jobs" on factory_jobs;
drop policy if exists "Factory staff update factory_jobs" on factory_jobs;
drop policy if exists "Factory staff delete factory_jobs" on factory_jobs;

create policy "Factory staff read factory_jobs" on factory_jobs for select to authenticated
  using (public.is_factory_staff(array['owner','admin','editor']));
create policy "Factory staff insert factory_jobs" on factory_jobs for insert to authenticated
  with check (public.is_factory_staff(array['owner','admin','editor']));
create policy "Factory staff update factory_jobs" on factory_jobs for update to authenticated
  using (public.is_factory_staff(array['owner','admin','editor']))
  with check (public.is_factory_staff(array['owner','admin','editor']));
create policy "Factory staff delete factory_jobs" on factory_jobs for delete to authenticated
  using (public.is_factory_staff(array['owner','admin']));

-- Check: each table should list four policies, none for the role `public`.
select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename in ('tenants', 'factory_jobs') order by 1, 3;
