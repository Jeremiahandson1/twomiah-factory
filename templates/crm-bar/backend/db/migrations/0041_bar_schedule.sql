-- The schedule (services/barSchedule.ts): planned shifts by person and day, the published week, time off.
CREATE TABLE IF NOT EXISTS "bar_schedule_shift" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"day" text NOT NULL,
	"start" text NOT NULL,
	"end" text NOT NULL,
	"position" text,
	"note" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_schedule_shift_company_day_idx" ON "bar_schedule_shift" ("company_id","day");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_schedule_week" (
	"id" text PRIMARY KEY NOT NULL,
	"week_start" text NOT NULL,
	"published_at" timestamp,
	"published_by_name" text,
	"snapshot" json,
	"changed_at" timestamp,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_schedule_week_company_week_key" ON "bar_schedule_week" ("company_id","week_start");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_time_off" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"day" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_name" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_time_off_company_day_idx" ON "bar_time_off" ("company_id","day");
