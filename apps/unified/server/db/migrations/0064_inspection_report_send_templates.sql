CREATE TABLE IF NOT EXISTS "inspection_report_template" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"intro" text,
	"sections" json DEFAULT '[]'::json NOT NULL,
	"layout" json,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection_report" ADD COLUMN "layout" json;--> statement-breakpoint
ALTER TABLE "inspection_report" ADD COLUMN "sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "inspection_report" ADD COLUMN "sent_via" text;--> statement-breakpoint
ALTER TABLE "inspection_report" ADD COLUMN "copies" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_report_template" ADD CONSTRAINT "inspection_report_template_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection_report_template" ADD CONSTRAINT "inspection_report_template_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_report_template_company_id_idx" ON "inspection_report_template" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inspection_report_template_company_name_uniq" ON "inspection_report_template" USING btree ("company_id","name");