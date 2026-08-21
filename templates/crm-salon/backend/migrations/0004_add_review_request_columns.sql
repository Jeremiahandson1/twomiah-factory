-- Add missing columns to review_request table for reviews generation feature
ALTER TABLE review_request ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'both';
ALTER TABLE review_request ADD COLUMN IF NOT EXISTS job_id TEXT REFERENCES job(id) ON DELETE SET NULL;
ALTER TABLE review_request ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ;
ALTER TABLE review_request ADD COLUMN IF NOT EXISTS follow_up_sent_at TIMESTAMPTZ;
ALTER TABLE review_request ADD COLUMN IF NOT EXISTS review_link TEXT;

CREATE INDEX IF NOT EXISTS review_request_status_idx ON review_request(status);
CREATE INDEX IF NOT EXISTS review_request_job_id_idx ON review_request(job_id);
