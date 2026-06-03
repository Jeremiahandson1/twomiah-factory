-- V1 Domain/Email: per-tenant email aliases + onboarding sentinel.

CREATE TABLE IF NOT EXISTS "email_alias" (
  "id" text PRIMARY KEY NOT NULL,
  "local_part" text NOT NULL,
  "routing_mode" text NOT NULL DEFAULT 'forward',
  "forward_to" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_alias_local_part_idx" ON "email_alias" ("local_part");
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "onboarding_completed_at" timestamp;
