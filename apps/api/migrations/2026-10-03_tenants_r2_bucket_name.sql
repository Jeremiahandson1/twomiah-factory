-- R2 media bucket a tenant's uploads live in. Declared in schema.sql but never applied to the live
-- Factory DB, so runDeploy's optional-fields update (website_url + ads_url + r2_bucket_name in one
-- statement) failed on it and every new tenant's website_url was lost with it. Also read by
-- services/deploy.ts provisionR2ForTenant to skip tenants that already have a bucket.
-- Run once against the Factory Supabase (SQL editor). Idempotent.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS r2_bucket_name text;
