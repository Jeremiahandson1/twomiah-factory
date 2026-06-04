-- Test-tenant flag. Set to true for any tenant created by the test harness
-- (scripts/test-factory-matrix.ts). hardDeleteTestTenant refuses to act on
-- rows where is_test_tenant != true, so this is the gate that keeps the
-- nuclear cleanup path from ever touching a real customer.
--
-- The 6h-safety-net cron uses this column plus created_at to find orphans
-- from crashed test runs.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_test_tenant boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS tenants_is_test_tenant_created_at_idx
  ON tenants (is_test_tenant, created_at)
  WHERE is_test_tenant = true;
