-- Auto-attached Twomiah subdomain for every premium tenant.
-- Filled at deploy time by attachTwomiahSubdomain() in deploy.ts:
-- `<slug>.twomiah.app` CNAME → Render website service, attached as a
-- custom domain on Render so TLS is automatic.
--
-- NULL when:
--   * tenant is non-premium (no website service to attach to)
--   * the env vars (TWOMIAH_APP_ZONE_ID + CLOUDFLARE_API_TOKEN +
--     RENDER_API_KEY) weren't set when the tenant deployed; admin can
--     backfill later by re-running the wire step
--   * the wire failed; check deploy logs for the Cloudflare or Render
--     error and retry from the admin tools
--
-- Format is the full https URL ("https://acme-cleaning.twomiah.app") so
-- the email/UI can render it directly without string concat.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twomiah_subdomain text;
