-- Add Instant Estimator columns to company table
ALTER TABLE company ADD COLUMN IF NOT EXISTS estimator_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE company ADD COLUMN IF NOT EXISTS price_per_square_low DECIMAL(10,2) NOT NULL DEFAULT 350.00;
ALTER TABLE company ADD COLUMN IF NOT EXISTS price_per_square_high DECIMAL(10,2) NOT NULL DEFAULT 550.00;
ALTER TABLE company ADD COLUMN IF NOT EXISTS estimator_headline TEXT NOT NULL DEFAULT 'Get Your Free Instant Estimate';
ALTER TABLE company ADD COLUMN IF NOT EXISTS estimator_disclaimer TEXT NOT NULL DEFAULT 'This is an automated estimate based on satellite data. Final pricing may vary after on-site inspection.';
