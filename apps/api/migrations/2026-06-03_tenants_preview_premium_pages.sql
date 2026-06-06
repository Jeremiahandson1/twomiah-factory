-- Multi-page premium preview storage.
--
-- The premium-tier preview is a 4-page site (home/about/services/contact),
-- not a single rendered HTML blob. We store the composed SiteResult JSON
-- (sections per page + rationale) and render on-demand at request time —
-- smaller payload than storing 4 HTML files, and gives staff something
-- editable as JSON before publishing.

alter table tenants
  add column if not exists preview_premium_pages jsonb,
  add column if not exists preview_premium_generated_at timestamptz;
