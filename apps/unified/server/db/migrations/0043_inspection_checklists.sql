CREATE TABLE IF NOT EXISTS "inspection_item" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"inspection_id" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"result" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"punch_list_item_id" text,
	"answered_at" timestamp,
	"answered_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inspection_template" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inspection_template_item" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"template_id" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection" ADD COLUMN IF NOT EXISTS "photos" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_item" ADD CONSTRAINT "inspection_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_item" ADD CONSTRAINT "inspection_item_inspection_id_inspection_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspection"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_template" ADD CONSTRAINT "inspection_template_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_template_item" ADD CONSTRAINT "inspection_template_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_template_item" ADD CONSTRAINT "inspection_template_item_template_id_inspection_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."inspection_template"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_item_company_id_idx" ON "inspection_item" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_item_inspection_id_idx" ON "inspection_item" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_template_company_id_idx" ON "inspection_template" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inspection_template_company_id_name_idx" ON "inspection_template" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_template_item_template_id_idx" ON "inspection_template_item" USING btree ("template_id");