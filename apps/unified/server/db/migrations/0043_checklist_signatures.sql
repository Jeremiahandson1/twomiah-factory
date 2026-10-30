ALTER TABLE "form_submission" ADD COLUMN "signed_ip" text;--> statement-breakpoint
ALTER TABLE "form_submission" ADD COLUMN "signed_user_agent" text;--> statement-breakpoint
ALTER TABLE "form_submission" ADD COLUMN "signature_hash" text;--> statement-breakpoint
ALTER TABLE "form_submission" ADD COLUMN "consent_at" timestamp;