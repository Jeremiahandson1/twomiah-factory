-- Adds preview_html + preview_generated_at to tenants for the show-first
-- website preview: a self-contained HTML draft rendered from an intake lead
-- and served via GET /api/v1/factory/public/intake/:id/preview.
--
-- Stored in a dedicated column (not intake_data) so the large HTML blob never
-- bloats the jsonb that dashboard list queries read. Re-running the preview
-- endpoint overwrites this in place.
--
-- Run on the live Supabase DB before deploying the preview endpoint, or the
-- save will fail with 42703 (undefined column).

alter table tenants
  add column if not exists preview_html text,
  add column if not exists preview_generated_at timestamptz;
