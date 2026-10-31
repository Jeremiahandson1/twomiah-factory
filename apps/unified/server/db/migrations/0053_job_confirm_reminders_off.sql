ALTER TABLE "contact" ADD COLUMN "job_reminders_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "confirmed_via" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "confirm_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_confirm_token_idx" ON "job" USING btree ("confirm_token");