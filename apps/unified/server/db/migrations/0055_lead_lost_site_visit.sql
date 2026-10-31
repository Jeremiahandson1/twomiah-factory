ALTER TABLE "lead" ADD COLUMN "lost_reason" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "lost_note" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "lost_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "site_visit_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "site_visit_event_id" text;