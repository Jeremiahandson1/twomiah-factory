-- Mark up a document: boxes, freehand and pinned notes, saved as named layers. The API is shared and
-- already serves these endpoints for any template that passes the table; only the table was missing here.
-- THE FOREIGN KEY IS ADDED SEPARATELY, AND ONLY IF ITS TABLE IS THERE. (T58d)
--
-- `document` is declared in db/schema.ts and created by NO migration, so on a database built from
-- the migration history alone this whole file threw `relation "document" does not exist` — and
-- because there were no statement separators either, the table and its index went down with it.
-- Every brand-new roofing tenant would have been stuck at migration 0015 for ever, and would still
-- have looked perfectly healthy: migrate runs before `drizzle-kit push --force`, push then builds
-- the schema from schema.ts, and the failure is only ever a line in the boot log.
--
-- Separated into statements, and the constraint is added conditionally so the column still gets its
-- foreign key on every database that has a document table — which is all of them in practice.
CREATE TABLE IF NOT EXISTS "plan_markup" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text DEFAULT 'Markup' NOT NULL,
  "data" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "document_id" text NOT NULL,
  "created_by_id" text REFERENCES "user"("id") ON DELETE SET NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'document')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_markup_document_id_fk') THEN
    ALTER TABLE "plan_markup"
      ADD CONSTRAINT "plan_markup_document_id_fk"
      FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_markup_document_id_idx" ON "plan_markup" ("document_id");
