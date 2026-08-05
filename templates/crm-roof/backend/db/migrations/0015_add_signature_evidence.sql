ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "signature" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "signed_by" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "signed_ip" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "signed_user_agent" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "signature_hash" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "consent_at" timestamp;
