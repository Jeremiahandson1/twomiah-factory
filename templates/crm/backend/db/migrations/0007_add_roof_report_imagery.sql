ALTER TABLE "roof_report" ADD COLUMN IF NOT EXISTS "aerial_image_path" text;
ALTER TABLE "roof_report" ADD COLUMN IF NOT EXISTS "roof_mask_path" text;
