ALTER TABLE "loyalty_members" ADD COLUMN IF NOT EXISTS "opted_in_sms_at" timestamp;--> statement-breakpoint
ALTER TABLE "loyalty_members" ADD COLUMN IF NOT EXISTS "opted_in_email_at" timestamp;--> statement-breakpoint
ALTER TABLE "loyalty_members" ADD COLUMN IF NOT EXISTS "consent_source" text;
