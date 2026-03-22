ALTER TABLE pricebook_item ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE pricebook_item ADD COLUMN IF NOT EXISTS customer_description text;
ALTER TABLE pricebook_item ADD COLUMN IF NOT EXISTS labor_hours decimal(8, 2);
ALTER TABLE pricebook_item ADD COLUMN IF NOT EXISTS show_to_customer boolean NOT NULL DEFAULT true;
