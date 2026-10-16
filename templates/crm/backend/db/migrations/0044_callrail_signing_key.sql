-- The CallRail webhook signing key, set by the owner in Call Tracking › Settings. Every CallRail webhook is
-- verified against it (Base64 HMAC-SHA1 of the raw body); without one, production refuses CallRail webhooks.
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "callrail_signing_key" text;
