-- tenants.billing_cycle
--
-- The Stripe webhook (services/factoryStripe.ts, checkout.session.completed) has always written
-- updates.billing_cycle from the checkout metadata, but the column never existed. PostgREST rejects an
-- update that names an unknown column (PGRST204), so on a real subscription checkout the WHOLE update —
-- stripe_subscription_id, billing_status = active, status = active — was lost and the tenant stayed
-- "pending". No paying subscription customer existed before 2026-09-11, so nobody was hit; the first one
-- would have been. routes/factory/billing.ts now also retries without unknown columns, but the column
-- is the real fix and lets the tenant billing page show the cycle the customer chose.
alter table tenants add column if not exists billing_cycle text;
comment on column tenants.billing_cycle is 'monthly | annual — chosen at Factory checkout (Stripe metadata billing_cycle)';
