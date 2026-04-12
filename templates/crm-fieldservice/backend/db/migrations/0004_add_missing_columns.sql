-- Add columns that exist in schema.ts but were missing from migrations
ALTER TABLE "service_agreement" ADD COLUMN IF NOT EXISTS "next_service_date" timestamp;
