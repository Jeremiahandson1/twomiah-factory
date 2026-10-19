CREATE SEQUENCE "public"."invoice_seq_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "seq_number" SET DEFAULT nextval('invoice_seq_number_seq');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_reset_token" ON "user" USING btree ("reset_token") WHERE reset_token IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_active_recurring_schedule" ON "schedules" USING btree ("caregiver_id","client_id","day_of_week",(start_time::time),(end_time::time)) WHERE is_active = true AND day_of_week IS NOT NULL AND end_date IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedules_is_training" ON "schedules" USING btree ("is_training") WHERE is_training = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedules_suspended_from" ON "schedules" USING btree ("suspended_from") WHERE suspended_from IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_open_time_entry_per_caregiver" ON "time_entries" USING btree ("caregiver_id") WHERE end_time IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_time_entries_needs_approval" ON "time_entries" USING btree ("needs_approval") WHERE needs_approval = true;