CREATE TABLE IF NOT EXISTS "import_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"file_name" text,
	"status" text DEFAULT 'done' NOT NULL,
	"rows_in_file" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"skipped_duplicates" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"undone_at" timestamp,
	"undone_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_batch_record" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"record_id" text NOT NULL,
	"line" integer,
	"undone" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_batch_record" ADD CONSTRAINT "import_batch_record_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_batch_record" ADD CONSTRAINT "import_batch_record_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_batch_company_idx" ON "import_batch" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_batch_record_batch_idx" ON "import_batch_record" USING btree ("batch_id");