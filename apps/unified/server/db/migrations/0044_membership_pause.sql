ALTER TABLE "membership_enrollment" ADD COLUMN "paused_for_payment_at" timestamp;--> statement-breakpoint
ALTER TABLE "membership_enrollment" ADD COLUMN "card_update_token" text;