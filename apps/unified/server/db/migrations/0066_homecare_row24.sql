ALTER TABLE "service_codes" ADD COLUMN "supervisory_interval_days" integer;--> statement-breakpoint
ALTER TABLE "supervisory_visit" ADD COLUMN "status" text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "supervisory_visit" ADD COLUMN "planned_at" timestamp;--> statement-breakpoint
ALTER TABLE "supervisory_visit" ADD COLUMN "answers" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "supervisory_visit" ADD COLUMN "supervisor_signature" text;--> statement-breakpoint
ALTER TABLE "supervisory_visit" ADD COLUMN "client_signature" text;--> statement-breakpoint
ALTER TABLE "supervisory_visit" ADD COLUMN "client_sign_reason" text;--> statement-breakpoint
ALTER TABLE "supervisory_visit" ADD COLUMN "signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "supervisory_visit" ADD COLUMN "started_at" timestamp;--> statement-breakpoint
ALTER TABLE "supervisory_visit" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "supervisory_visit" ADD COLUMN "recorded_from" text DEFAULT 'office' NOT NULL;--> statement-breakpoint
ALTER TABLE "supervisory_visit" ADD COLUMN "reminder_sent_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supervisory_visit_planned_idx" ON "supervisory_visit" USING btree ("company_id","status","planned_at");