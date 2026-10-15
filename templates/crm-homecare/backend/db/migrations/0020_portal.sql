-- Portal catch-up: client portal accounts, family portal permissions and
-- messages, notification status workflow, notification preferences.
--
-- 1. client_portal_accounts — one login per person, several per client.
--    Until now the portal login lived on the clients row (portal_email +
--    portal_password_hash), so a family shared one email and one password:
--    no record of who looked at what, no way to take one person's access
--    away, and one person's typos or password reset hit everybody. Each
--    account has its own lockout counter and its own invite/reset token.
--    The existing single login on each client is copied across below.
CREATE TABLE IF NOT EXISTS "client_portal_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "email" text NOT NULL,
  "display_name" text,
  "password_hash" text,
  "portal_enabled" boolean DEFAULT false NOT NULL,
  "failed_login_count" integer DEFAULT 0 NOT NULL,
  "locked_until" timestamp,
  "invite_token" text,
  "invite_expires_at" timestamp,
  "last_login" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_portal_accounts"
    ADD CONSTRAINT "client_portal_accounts_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- Email is the login key, so it is unique across every client. Stored lowercase.
CREATE UNIQUE INDEX IF NOT EXISTS "client_portal_accounts_email_idx" ON "client_portal_accounts" ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_portal_accounts_client_id_idx" ON "client_portal_accounts" ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_portal_accounts_invite_token_idx" ON "client_portal_accounts" ("invite_token");
--> statement-breakpoint
-- Copy each client's existing login. Enabled only where it could actually sign
-- in before (portal on AND a password set). A client invited but not yet set up
-- keeps a working setup link: the old link carried clients.portal_token.
-- Two clients sharing one portal email: the enabled, most recently updated one
-- keeps it (DISTINCT ON), the other is left for the office to re-invite.
INSERT INTO "client_portal_accounts"
  ("id", "client_id", "email", "password_hash", "portal_enabled",
   "invite_token", "invite_expires_at", "last_login", "created_at", "updated_at")
SELECT DISTINCT ON (lower(trim(c."portal_email")))
  'cpa' || md5(c."id"),
  c."id",
  lower(trim(c."portal_email")),
  c."portal_password_hash",
  (c."portal_enabled" AND c."portal_password_hash" IS NOT NULL),
  CASE WHEN c."portal_password_hash" IS NULL THEN c."portal_token" END,
  CASE WHEN c."portal_password_hash" IS NULL AND c."portal_token" IS NOT NULL
       THEN COALESCE(c."portal_token_exp", now() + interval '48 hours') END,
  c."last_portal_visit",
  now(),
  now()
FROM "clients" c
WHERE c."portal_email" IS NOT NULL AND trim(c."portal_email") <> ''
ORDER BY lower(trim(c."portal_email")), c."portal_enabled" DESC, c."updated_at" DESC
ON CONFLICT ("email") DO NOTHING;
--> statement-breakpoint
-- 2. Family portal: what each relative may see, and the message reply trail.
ALTER TABLE "family_members" ADD COLUMN IF NOT EXISTS "can_view_schedule" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN IF NOT EXISTS "can_view_care_plan" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN IF NOT EXISTS "can_view_medications" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN IF NOT EXISTS "can_message" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN IF NOT EXISTS "is_primary_contact" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "family_messages" ADD COLUMN IF NOT EXISTS "subject" text;
--> statement-breakpoint
ALTER TABLE "family_messages" ADD COLUMN IF NOT EXISTS "reply" text;
--> statement-breakpoint
ALTER TABLE "family_messages" ADD COLUMN IF NOT EXISTS "replied_at" timestamp;
--> statement-breakpoint
ALTER TABLE "family_messages" ADD COLUMN IF NOT EXISTS "replied_by_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "family_messages"
    ADD CONSTRAINT "family_messages_replied_by_id_users_id_fk"
    FOREIGN KEY ("replied_by_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- 3. Staff notifications: new -> handled -> archived. is_read and status move
--    together (the bell counts status = 'new'), so a row already read is
--    handled from the start.
--    0005 may already have added a "status" column (varchar, DEFAULT 'sent', never
--    in schema.ts, so a boot's schema push may since have dropped it). Both shapes
--    end the same: text, DEFAULT 'new', NOT NULL, every row new or handled.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'new';
--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "status" TYPE text;
--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "status" SET DEFAULT 'new';
--> statement-breakpoint
UPDATE "notifications"
   SET "status" = CASE WHEN "is_read" THEN 'handled' ELSE 'new' END
 WHERE "status" IS NULL OR "status" NOT IN ('new', 'handled', 'archived');
--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "status" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "handled_at" timestamp;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "handled_by_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_handled_by_id_users_id_fk"
    FOREIGN KEY ("handled_by_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_status_idx" ON "notifications" ("user_id", "status");
--> statement-breakpoint
UPDATE "notifications" SET "status" = 'handled', "handled_at" = COALESCE("handled_at", now())
WHERE "is_read" = true AND ("status" = 'new' OR ("status" = 'handled' AND "handled_at" IS NULL));
--> statement-breakpoint
-- 4. Per-person delivery preferences: channels, more alert types, quiet hours.
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "sms_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "shift_reminder_alerts" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "payroll_alerts" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "payment_alerts" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "low_auth_alerts" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "expiring_cert_alerts" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "message_alerts" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "quiet_hours_start" time;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "quiet_hours_end" time;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "quiet_hours_skip_emergency" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- 5. A client's own notification preferences. 0005 created this table but it
--    was never in schema.ts, so a boot's schema push may have removed it;
--    created again here (no-op where it survived) and now declared in schema.ts.
CREATE TABLE IF NOT EXISTS "client_notification_preferences" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "email_enabled" boolean DEFAULT true,
  "portal_enabled" boolean DEFAULT true,
  "caregiver_alerts" boolean DEFAULT true,
  "schedule_alerts" boolean DEFAULT true,
  "billing_alerts" boolean DEFAULT true,
  "assignment_alerts" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "client_notification_preferences_client_id_key" UNIQUE ("client_id")
);
--> statement-breakpoint
-- 6. Client notifications point at what they are about.
ALTER TABLE "client_notifications" ADD COLUMN IF NOT EXISTS "related_visit_id" text;
--> statement-breakpoint
ALTER TABLE "client_notifications" ADD COLUMN IF NOT EXISTS "related_invoice_id" text;
--> statement-breakpoint
ALTER TABLE "client_notifications" ADD COLUMN IF NOT EXISTS "related_caregiver_id" text;
