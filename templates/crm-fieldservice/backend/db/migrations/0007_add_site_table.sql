CREATE TABLE IF NOT EXISTS "site" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "address" text,
  "city" text,
  "state" text,
  "zip" text,
  "access_notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "contact_id" text NOT NULL REFERENCES "contact"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "site_company_id_idx" ON "site" ("company_id");
CREATE INDEX IF NOT EXISTS "site_contact_id_idx" ON "site" ("contact_id");
