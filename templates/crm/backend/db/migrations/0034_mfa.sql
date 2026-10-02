-- TWO-FACTOR FOR THE CONTRACTOR CRM. (T57)
--
-- Ported from crm-dispensary, which had the only implementation in the fleet. The engine lives in
-- shared auth (packages/tenant-backend/src/auth/mfa.ts) and decides whether two-factor is possible by
-- asking the database for these two tables — so creating them is what switches the feature on, and
-- forgetting a config flag cannot leave a vertical with enrolment screens and a sign-in that ignores
-- them, which is the exact fault T49 H4 found on the dispensary.
--
-- This database holds the client list, the contract values, the payroll rates, the vendor bills and a
-- Stripe connection. Until now the password was the only thing in front of all of it.

CREATE TABLE IF NOT EXISTS "mfa_devices" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "company_id" text NOT NULL,
  -- totp | backup_codes
  "type" text NOT NULL,
  "name" text,
  -- the base32 TOTP seed; read only by the verifier, never returned after enrolment
  "secret" text,
  "phone_number" text,
  -- recovery codes, SHA-256 hashed, removed as they are spent
  "backup_codes" json,
  -- an enrolment nobody finished is not a second factor, so the gate counts only verified rows
  "is_verified" boolean DEFAULT false,
  "is_primary" boolean DEFAULT false,
  "last_used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "mfa_challenges" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "device_id" text,
  "code" text,
  -- 'login' for the sign-in challenge
  "type" text NOT NULL,
  "status" text DEFAULT 'pending',
  -- wrong codes spent against this challenge; five and it is done
  "attempts" integer DEFAULT 0 NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "expires_at" timestamp NOT NULL,
  "verified_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "mfa_devices" ADD CONSTRAINT "mfa_devices_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "mfa_devices" ADD CONSTRAINT "mfa_devices_company_id_company_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ON DELETE SET NULL: a challenge row records that a sign-in happened, and the authenticator it used
-- may be removed later. Without this, turning two-factor off answers 409 for anybody who has ever
-- completed a sign-in with that device.
DO $$ BEGIN
  ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_device_id_mfa_devices_id_fk"
    FOREIGN KEY ("device_id") REFERENCES "mfa_devices"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "mfa_device_user_idx" ON "mfa_devices" ("user_id");
CREATE INDEX IF NOT EXISTS "mfa_device_company_idx" ON "mfa_devices" ("company_id");
CREATE INDEX IF NOT EXISTS "mfa_challenge_user_idx" ON "mfa_challenges" ("user_id");
