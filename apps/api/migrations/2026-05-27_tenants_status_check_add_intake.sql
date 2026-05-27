-- The tenants_status_check constraint (originally added via Supabase dashboard,
-- not tracked in repo migrations) didn't include 'intake', so inserts from
-- POST /api/v1/factory/public/intake were failing with Postgres 23514
-- (check_violation). This drops the old constraint and recreates it with the
-- full set of status values the application code actually writes:
--
--   pending       — default for /signup, awaiting trial start
--   intake        — lead from /businesses intake form, not yet a tenant
--   deploying     — factory is provisioning the CRM (factory.ts:803, 1063)
--   deploy_failed — provisioning errored (factory.ts:811)
--   active        — live, paying customer
--   offboarded    — fully removed (factory.ts:1381)
--   churned       — cancelled, data retained
--   paused        — voluntarily paused by customer
--   suspended     — payment failed, temporarily disabled
--
-- If any existing row has a status value NOT in this list, the ADD CONSTRAINT
-- will fail and tell you which value to add. Inspect with:
--   select distinct status, count(*) from tenants group by status;
-- before applying.

alter table tenants drop constraint if exists tenants_status_check;

alter table tenants add constraint tenants_status_check check (
  status in (
    'pending',
    'intake',
    'deploying',
    'deploy_failed',
    'active',
    'offboarded',
    'churned',
    'paused',
    'suspended'
  )
);
