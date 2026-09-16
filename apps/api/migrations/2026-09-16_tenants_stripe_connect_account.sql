-- Stripe Connect: which connected account a tenant's business collects card payments on.
-- Registered by the tenant CRM (POST /api/v1/factory/customers/:id/stripe-connect) when the owner clicks
-- "Connect Stripe"; the Factory's Connect webhook receiver (POST /api/v1/factory/stripe/connect-webhook)
-- looks the tenant up by it and forwards that account's events to the tenant. (#154)
-- Run once against the Factory Supabase (SQL editor). Idempotent.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_connect_account_id text;
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_connect_account ON tenants(stripe_connect_account_id) WHERE stripe_connect_account_id IS NOT NULL;
