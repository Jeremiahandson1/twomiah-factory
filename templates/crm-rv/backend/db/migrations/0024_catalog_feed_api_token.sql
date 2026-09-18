-- Phase 3: API-based distributor feeds (WPS Data Depot) need the dealer's own API
-- access token, stored alongside the feed config.

ALTER TABLE "catalog_feed" ADD COLUMN IF NOT EXISTS "api_token" text;
