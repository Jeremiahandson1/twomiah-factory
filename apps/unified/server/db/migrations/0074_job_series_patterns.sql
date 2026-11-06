ALTER TABLE "job_series" ADD COLUMN "skip_weekdays" text;--> statement-breakpoint
ALTER TABLE "job_series" ADD COLUMN "exclude_dates" text;--> statement-breakpoint
ALTER TABLE "job_series" ADD COLUMN "nth_positions" text;--> statement-breakpoint
ALTER TABLE "job_series" ADD COLUMN "nth_weekday" integer;