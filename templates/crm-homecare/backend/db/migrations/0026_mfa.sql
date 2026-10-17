-- Two-factor sign-in. Home care was one of two CRMs whose sign-in took a password and nothing else — for an agency
-- holding clients' medications, care plans and Medicaid IDs.
--
-- The engine is shared auth (packages/tenant-backend/src/auth/mfa.ts), which decides whether two-factor is possible by
-- asking information_schema for these two tables, so creating them is what switches the feature on. Column names match
-- the fleet's (crm-salon 0030_mfa) because the shared statements name them; users.id is text here, so user_id is too.
-- Times carry their zone: a challenge's ten-minute expiry is compared with the clock, and a zoneless value read on a
-- server in another zone would expire early or late.
--
-- company_id stays, though this database is one agency and users carry none: the shared statements scope by it, and
-- helpers/mfaScope.ts gives it one fixed value. One set of statements, not a second copy with the filter gone.
--
-- These are migrations-owned like the rest of this schema (db/NO_DRIZZLE_PUSH); db/schema.ts declares the same tables
-- so db/reconcile.ts and the code agree.
CREATE TABLE IF NOT EXISTS "mfa_devices" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "company_id" text NOT NULL,
  "type" text NOT NULL,
  "name" text,
  "secret" text,
  "phone_number" text,
  "backup_codes" json,
  "is_verified" boolean DEFAULT false,
  "is_primary" boolean DEFAULT false,
  "last_used_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mfa_challenges" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "device_id" text,
  "code" text,
  "type" text NOT NULL,
  "status" text DEFAULT 'pending',
  "attempts" integer DEFAULT 0 NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "expires_at" timestamptz NOT NULL,
  "verified_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "mfa_devices"
    ADD CONSTRAINT "mfa_devices_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "mfa_challenges"
    ADD CONSTRAINT "mfa_challenges_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- SET NULL: a challenge records that a sign-in happened, and the authenticator it used may be removed later. Without
-- it, turning two-factor off is refused for anybody who has ever signed in with that device (the fleet's T57 fault).
DO $$ BEGIN
  ALTER TABLE "mfa_challenges"
    ADD CONSTRAINT "mfa_challenges_device_id_mfa_devices_id_fk"
    FOREIGN KEY ("device_id") REFERENCES "mfa_devices"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mfa_device_user_idx" ON "mfa_devices" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mfa_challenge_user_idx" ON "mfa_challenges" ("user_id");
