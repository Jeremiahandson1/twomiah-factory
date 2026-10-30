ALTER TABLE "job" ADD COLUMN "recurring_route_stop_id" text;--> statement-breakpoint
ALTER TABLE "recurring_route" ADD COLUMN "start_time" text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_route_stop_day_idx" ON "job" USING btree ("recurring_route_stop_id","scheduled_date") WHERE recurring_route_stop_id IS NOT NULL;