-- ─────────────────────────────────────────────────────────────────────────────
-- Feature-sync hardening: add persistent visibility so a failed Factory→CRM
-- sync can never silently lie about success.
--
-- Idempotent. Safe to run multiple times.
-- Apply via Supabase SQL editor on the Factory project.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Audit table (already referenced by apps/api/src/routes/factory.ts:3563
--    via supabase.from('tenant_feature_audit').insert(...), but the table
--    was never created — every insert silently fails).
CREATE TABLE IF NOT EXISTS public.tenant_feature_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  action          text NOT NULL,                 -- 'enable' | 'disable' | 'bulk_update' | 'resync'
  features        jsonb,                          -- changed feature keys (added ∪ removed)
  previous        jsonb,                          -- prior tenants.features list
  current         jsonb,                          -- new tenants.features list
  changed_by      text,
  synced_to_crm   boolean NOT NULL DEFAULT false,
  sync_error      text,                           -- null on success, message on failure
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_feature_audit_tenant_id_idx
  ON public.tenant_feature_audit(tenant_id, created_at DESC);

-- 2. Last-sync state on tenants. Single jsonb column keeps it
--    backwards-compatible (no required reads) and easy to extend.
--    Shape: { at, ok, error, sent_count, received_count, mode }
--      at:             ISO timestamp of the attempt
--      ok:             true if CRM received and confirmed the full list
--      error:          string when !ok, null when ok
--      sent_count:     features.length we POSTed
--      received_count: features.length the CRM returned (verify-after-push)
--      mode:           'http' | 'db' | 'none' (which sync path ran)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS last_feature_sync jsonb;

-- Optional partial index to find tenants whose last sync failed.
CREATE INDEX IF NOT EXISTS tenants_last_feature_sync_failed_idx
  ON public.tenants((last_feature_sync->>'ok'))
  WHERE last_feature_sync IS NOT NULL AND (last_feature_sync->>'ok') = 'false';

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, only if needed):
--   ALTER TABLE public.tenants DROP COLUMN IF EXISTS last_feature_sync;
--   DROP TABLE IF EXISTS public.tenant_feature_audit;
-- ─────────────────────────────────────────────────────────────────────────────
