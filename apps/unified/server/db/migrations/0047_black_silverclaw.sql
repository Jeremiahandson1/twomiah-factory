ALTER TABLE "caregiver_profiles" ADD COLUMN "payroll_worker_id" text;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD COLUMN "double_time_hours" numeric(8, 2) DEFAULT '0' NOT NULL;