-- Reports, dashboards and the route optimizer, brought up to the CVHC CRM.
--
-- 1. agencies.timezone — the agency's own clock. Every report counts days the way the office
--    lives them: an evening visit belongs to its own day, "today" on the dashboard does not roll
--    over at 7pm, and a 9am visit is not "five hours late" because the server runs on UTC. NULL
--    means "not set yet"; services/agencyTime.ts then uses AGENCY_TIMEZONE, else the agency's
--    state's zone, else America/Chicago. Every reader of the agency's zone goes through that file.
--
-- 2. Columns the shared schedule engine and Client Hours by Week read. The visits area ports the
--    features that WRITE them (training shifts, suspend service, cancel reasons, time-entry
--    approvals); the definitions here are CVHC's own (migrations v27, v50, v54, v63) so the two
--    ports agree, and IF NOT EXISTS makes whichever runs second a no-op.
--
-- 3. Route plans: the route optimizer saves a planned day with its service minutes, stop count,
--    notes and author, and each stop's service units, notes and live status. The tables already
--    exist; these are the columns the CVHC planner records that the template's tables lacked.

ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "timezone" text;
--> statement-breakpoint
-- The one agency clock: a zone an agency already saved under settings.timezone (the earlier home of
-- this setting) carries over, so nobody's day boundaries move.
UPDATE "agencies" SET "timezone" = "settings"->>'timezone'
 WHERE "timezone" IS NULL AND COALESCE("settings"->>'timezone', '') <> '';
--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "is_training" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "suspended_from" date;
--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "needs_approval" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "approval_reason" text;
--> statement-breakpoint
ALTER TABLE "route_plans" ADD COLUMN IF NOT EXISTS "total_service_minutes" integer;
--> statement-breakpoint
ALTER TABLE "route_plans" ADD COLUMN IF NOT EXISTS "stop_count" integer;
--> statement-breakpoint
ALTER TABLE "route_plans" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint
ALTER TABLE "route_plans" ADD COLUMN IF NOT EXISTS "created_by_id" text;
--> statement-breakpoint
ALTER TABLE "route_plan_stops" ADD COLUMN IF NOT EXISTS "service_units" integer;
--> statement-breakpoint
ALTER TABLE "route_plan_stops" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint
ALTER TABLE "route_plan_stops" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "route_plan_stops" ADD COLUMN IF NOT EXISTS "actual_arrival" timestamp;
--> statement-breakpoint
ALTER TABLE "route_plan_stops" ADD COLUMN IF NOT EXISTS "actual_departure" timestamp;
