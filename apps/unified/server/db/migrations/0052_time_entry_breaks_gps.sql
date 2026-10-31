ALTER TABLE "time_entry" ADD COLUMN "break_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "break_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "time_set_by_phone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "clock_in_lat" real;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "clock_in_lng" real;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "clock_out_lat" real;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "clock_out_lng" real;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "clock_source" text;