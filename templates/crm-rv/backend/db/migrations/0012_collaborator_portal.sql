-- BuilderTrend-style collaborator portal: allow subs/architects to log in via
-- their contact portal token and see role-scoped jobs, lien waivers, submittals,
-- and shared documents.

-- ═══════════════════════════════════════════════════
-- JOB → SUBCONTRACTOR ASSIGNMENT
-- ═══════════════════════════════════════════════════

ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "subcontractor_id" text;

DO $$ BEGIN
  ALTER TABLE "job"
    ADD CONSTRAINT "job_subcontractor_id_contact_id_fk"
    FOREIGN KEY ("subcontractor_id") REFERENCES "contact"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "job_subcontractor_id_idx" ON "job" ("subcontractor_id");

-- ═══════════════════════════════════════════════════
-- DOCUMENT SHARING (per-contact access to documents)
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "document_share" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "contact_id" text NOT NULL,
  "shared_by_id" text,
  "shared_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "document_share"
    ADD CONSTRAINT "document_share_document_id_document_id_fk"
    FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "document_share"
    ADD CONSTRAINT "document_share_contact_id_contact_id_fk"
    FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "document_share"
    ADD CONSTRAINT "document_share_shared_by_id_user_id_fk"
    FOREIGN KEY ("shared_by_id") REFERENCES "user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "document_share_unique"
  ON "document_share" ("document_id", "contact_id");
CREATE INDEX IF NOT EXISTS "document_share_contact_idx"
  ON "document_share" ("contact_id");
