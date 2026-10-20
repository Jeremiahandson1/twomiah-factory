-- Which engine a tenant runs (cutover, owner's "go" 2026-10-20): 'templates' — the per-vertical CRM template + website
-- services the Factory has always built — or 'unified', the one unified app (apps/unified) on its own service and its
-- own database server (apps/api/src/unified/factory.ts). Set once, at signup, from the UNIFIED_SIGNUPS switch
-- (off | test | all; off by default): nothing ever flips an existing tenant. Every existing row is 'templates'.
-- Until this runs, signup leaves the column out (the switch is off) and every tenant reads as 'templates'.
-- Run once against the Factory Supabase (SQL editor). Idempotent — safe to run again.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS engine text NOT NULL DEFAULT 'templates';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_engine_check') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_engine_check CHECK (engine IN ('templates', 'unified'));
  END IF;
END $$;
