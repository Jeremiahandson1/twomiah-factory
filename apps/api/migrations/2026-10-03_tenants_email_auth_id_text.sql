-- sendgrid_domain_auth_id holds the email-auth provider's domain id. It was bigint (SendGrid's
-- numeric ids); Resend — the current provider — returns UUIDs, so every write failed with 22P02
-- and NO tenant ever had its id saved. Re-wiring then tried to create the Resend domain again
-- (403 "registered already") and the email-domain status/verify routes had nothing to read.
-- text holds both. Found provisioning Higgs Heritage Builders.
-- Run once against the Factory Supabase (SQL editor). Idempotent.
ALTER TABLE tenants ALTER COLUMN sendgrid_domain_auth_id TYPE text USING sendgrid_domain_auth_id::text;
