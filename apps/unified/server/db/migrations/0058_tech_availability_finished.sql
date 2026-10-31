DROP INDEX IF EXISTS "tech_hours_user_weekday_key";--> statement-breakpoint
DROP INDEX IF EXISTS "tech_hours_member_weekday_key";--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "time_off_id" text;--> statement-breakpoint
ALTER TABLE "tech_hours" ADD COLUMN "kind" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "tech_hours" ADD COLUMN "ends_next_day" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tech_hours" ADD COLUMN "starts_on" timestamp;--> statement-breakpoint
ALTER TABLE "tech_hours" ADD COLUMN "ends_on" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_time_off_idx" ON "time_entry" USING btree ("time_off_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tech_hours_user_idx" ON "tech_hours" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tech_hours_member_idx" ON "tech_hours" USING btree ("member_id");