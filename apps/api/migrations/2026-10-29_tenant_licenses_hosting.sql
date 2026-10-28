-- The own-it licence's hosting choice (services/ownItLicense.ts): at checkout the owner picks "Keep Twomiah hosting it"
-- ('twomiah') or "I'll host it myself" ('self'). For 'self', on payment the hosting subscription is set to end at the END of
-- the current paid period (never mid-period); the date it ends and the outcome are kept on the licence row.
-- Run once against the Factory Supabase (SQL editor), after 2026-10-28_tenant_licenses.sql. Idempotent.
alter table tenant_licenses add column if not exists hosting         text not null default 'twomiah';
alter table tenant_licenses add column if not exists hosting_end_at  timestamptz;
alter table tenant_licenses add column if not exists hosting_note    text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_licenses_hosting_check') then
    alter table tenant_licenses add constraint tenant_licenses_hosting_check check (hosting in ('twomiah', 'self'));
  end if;
end $$;
