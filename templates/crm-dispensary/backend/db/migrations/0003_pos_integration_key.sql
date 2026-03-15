-- Add integration_key column to company table for external POS authentication
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "integration_key" TEXT;
