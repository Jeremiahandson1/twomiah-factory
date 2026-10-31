ALTER TABLE "job_photo" ADD COLUMN "source_photo_id" text;--> statement-breakpoint
ALTER TABLE "job_photo" ADD COLUMN "markup" json;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_photo_source_photo_id_uniq" ON "job_photo" USING btree ("source_photo_id");