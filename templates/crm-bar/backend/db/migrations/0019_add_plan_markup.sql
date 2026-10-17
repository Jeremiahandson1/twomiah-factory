-- Mark up a document: boxes, freehand and pinned notes, saved as named layers. The API is shared and
-- already serves these endpoints for any template that passes the table; only the table was missing here.
CREATE TABLE IF NOT EXISTS "plan_markup" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text DEFAULT 'Markup' NOT NULL,
  "data" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "document_id" text NOT NULL REFERENCES "document"("id") ON DELETE CASCADE,
  "created_by_id" text REFERENCES "user"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "plan_markup_document_id_idx" ON "plan_markup" ("document_id");
