-- Domain renewals are billed to the customer, then renewed by us (services/domainRenewal.ts, 10/14), at cost plus the
-- Stripe fee from Namecheap's live renewal price (config/domainPricing.ts).
-- Until this runs, the renewal cron logs "column does not exist" for its own step and does nothing else —
-- the warnings, subscriptions and teardowns beside it are unaffected.
-- Run once against the Factory Supabase (SQL editor). Idempotent — safe to run again.

-- A renewal price staff set by hand, in cents. Null (the normal case) = Namecheap's live renewal price + Stripe fee.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain_renewal_price_cents integer;
-- The Stripe invoice billing the coming renewal; cleared once the domain is renewed.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain_renewal_invoice_id text;
-- Set by the paid webhook when it claims the renewal — the guard that renews a domain once per invoice.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain_renewal_paid_invoice_id text;
-- Why a renewal could not be billed or completed; staff clear it once resolved. The cron leaves the tenant alone while set.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain_renewal_error text;

-- An earlier draft of this file fixed Higgs Heritage Builders at $9.29 — Namecheap's FIRST-YEAR .com price, below
-- what a renewal costs. Everyone is now billed at Namecheap's live renewal price plus the Stripe fee, Higgs included,
-- so undo that if the draft was run. Touches nothing else.
UPDATE tenants SET domain_renewal_price_cents = NULL
WHERE id = '6afba30a-06c1-4202-9841-59ced9ee5dbc' AND domain_renewal_price_cents = 929;
