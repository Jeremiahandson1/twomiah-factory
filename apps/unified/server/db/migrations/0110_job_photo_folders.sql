CREATE TABLE IF NOT EXISTS "job_photo_folder" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "photo_folder_id" text;--> statement-breakpoint
ALTER TABLE "job_photo" ADD COLUMN "folder_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_photo_folder" ADD CONSTRAINT "job_photo_folder_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_photo_folder" ADD CONSTRAINT "job_photo_folder_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_photo_folder_company_id_idx" ON "job_photo_folder" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_photo_folder_job_name_uniq" ON "job_photo_folder" USING btree ("job_id","name");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document" ADD CONSTRAINT "document_photo_folder_id_job_photo_folder_id_fk" FOREIGN KEY ("photo_folder_id") REFERENCES "public"."job_photo_folder"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_photo" ADD CONSTRAINT "job_photo_folder_id_job_photo_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."job_photo_folder"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_photo_folder_id_idx" ON "job_photo" USING btree ("folder_id");