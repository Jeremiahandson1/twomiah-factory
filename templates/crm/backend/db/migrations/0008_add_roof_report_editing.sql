ALTER TABLE roof_report ADD COLUMN IF NOT EXISTS user_edited boolean DEFAULT false NOT NULL;
ALTER TABLE roof_report ADD COLUMN IF NOT EXISTS original_edges json;
ALTER TABLE roof_report ADD COLUMN IF NOT EXISTS original_measurements json;
