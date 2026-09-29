ALTER TABLE "client_profile" ADD COLUMN IF NOT EXISTS "formulas" json DEFAULT '[]'::json NOT NULL;
