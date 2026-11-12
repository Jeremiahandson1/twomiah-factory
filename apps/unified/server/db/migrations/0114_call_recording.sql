ALTER TABLE "company" ADD COLUMN "call_recording" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "call_recording_notice" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "call_recording_keep_days" integer DEFAULT 365;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "recording_sid" text;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "recording_seconds" integer;