ALTER TABLE "medication_logs" ADD COLUMN "dose_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "medication_logs_dose_key_idx" ON "medication_logs" USING btree ("dose_key");