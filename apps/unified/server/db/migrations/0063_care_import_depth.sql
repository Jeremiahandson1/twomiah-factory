CREATE TABLE IF NOT EXISTS "custom_field_value" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"entity" text NOT NULL,
	"record_id" text NOT NULL,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_external_id" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"entity" text NOT NULL,
	"external_id" text NOT NULL,
	"record_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"headers" json NOT NULL,
	"mapping" json NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "migration_file" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"request_id" text NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"data" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "migration_request" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"from_system" text,
	"note" text,
	"old_counts" json,
	"signoffs" json DEFAULT '{}'::json NOT NULL,
	"batch_ids" json DEFAULT '[]'::json NOT NULL,
	"staff_note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "updated" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "attached" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "source" text DEFAULT 'office' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "options" json;--> statement-breakpoint
ALTER TABLE "import_batch_record" ADD COLUMN "table_name" text;--> statement-breakpoint
ALTER TABLE "import_batch_record" ADD COLUMN "action" text DEFAULT 'created' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch_record" ADD COLUMN "previous" json;--> statement-breakpoint
ALTER TABLE "import_batch_record" ADD COLUMN "extra" json;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_external_id" ADD CONSTRAINT "import_external_id_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_mapping" ADD CONSTRAINT "import_mapping_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "migration_file" ADD CONSTRAINT "migration_file_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "migration_file" ADD CONSTRAINT "migration_file_request_id_migration_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."migration_request"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "migration_request" ADD CONSTRAINT "migration_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_value_key" ON "custom_field_value" USING btree ("company_id","entity","record_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_external_id_key" ON "import_external_id" USING btree ("company_id","entity","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_external_id_record_idx" ON "import_external_id" USING btree ("company_id","entity","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_mapping_company_kind_name" ON "import_mapping" USING btree ("company_id","kind","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "migration_file_request_idx" ON "migration_file" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "migration_request_company_idx" ON "migration_request" USING btree ("company_id","created_at");