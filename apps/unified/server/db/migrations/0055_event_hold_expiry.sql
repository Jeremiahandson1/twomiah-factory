ALTER TABLE "event" ADD COLUMN "hold_until" date;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "hold_reminder_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "hold_released_at" timestamp;