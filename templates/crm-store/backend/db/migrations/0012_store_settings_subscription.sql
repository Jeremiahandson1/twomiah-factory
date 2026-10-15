-- The Factory's subscription summary for this store, mirrored so a cancelled store's admin is locked and its owner can
-- restart it by paying (packages/tenant-backend/src/auth/accountLock.ts). NULL until the Factory first answers: open.
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "subscription" jsonb;
