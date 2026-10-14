-- Domain renewals are billed to the customer, then renewed by us (services/domainRenewal.ts, 10/14).
-- Until this runs, the renewal cron logs "column does not exist" for its own step and does nothing else —
-- the warnings, subscriptions and teardowns beside it are unaffected.
-- Run once against the Factory Supabase (SQL editor). Idempotent.

-- What one year of renewal costs THIS customer. Null = our retail price for the TLD (config/domainPricing.ts).
-- Set for at-cost accounts (register-at-cost writes it).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain_renewal_price_cents integer;
-- The Stripe invoice billing the coming renewal; cleared once the domain is renewed.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain_renewal_invoice_id text;
-- Set by the paid webhook when it claims the renewal — the guard that renews a domain once per invoice.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain_renewal_paid_invoice_id text;
-- Why a renewal could not be billed or completed; staff clear it once resolved. The cron leaves the tenant alone while set.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain_renewal_error text;

-- Higgs Heritage Builders: registered at cost on 2026-10-03 ("only charge them what we get charged") — renew at
-- cost too: $9.29/yr for a .com (config/domainPricing.ts costCents). Only if nothing is set yet.
UPDATE tenants SET domain_renewal_price_cents = 929
WHERE id = '6afba30a-06c1-4202-9841-59ced9ee5dbc' AND domain = 'higgsheritagebuilders.com' AND domain_renewal_price_cents IS NULL;
