-- Why a batch was quarantined, recalled or released, next to the status itself.
--
-- GUARDED ON THE TABLE EXISTING. (T58d)
--
-- `batches` is declared in db/schema.ts and created by NO migration — this template's schema is
-- almost entirely built by the `drizzle-kit push --force` in the start command, which runs AFTER
-- `bun db/migrate.ts`. So on a database built from the migration history alone, which is every
-- brand-new dispensary tenant, this threw `relation "batches" does not exist`; a run is one
-- transaction, so it stranded this migration and every migration after it, permanently. The tenant
-- still came up, because push then built the schema, and migrate.ts called the failure a connection
-- problem. The dispensary tenant that exists today reports "[migrate] Success" because it applied
-- this long ago, when an earlier boot's push had already made the table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'batches') THEN
    ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "status_reason" text;
  END IF;
END $$;
