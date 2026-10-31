CREATE TABLE IF NOT EXISTS "visit_item" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"detail" text,
	"goal_id" text,
	"form_template_id" text,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_item_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"item_id" text NOT NULL,
	"status" text NOT NULL,
	"rating" text,
	"note" text,
	"form_submission_id" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_item" ADD CONSTRAINT "visit_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_item" ADD CONSTRAINT "visit_item_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_item" ADD CONSTRAINT "visit_item_form_template_id_form_templates_id_fk" FOREIGN KEY ("form_template_id") REFERENCES "public"."form_templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_item_log" ADD CONSTRAINT "visit_item_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_item_log" ADD CONSTRAINT "visit_item_log_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_item_log" ADD CONSTRAINT "visit_item_log_item_id_visit_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."visit_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_item_log" ADD CONSTRAINT "visit_item_log_form_submission_id_form_submissions_id_fk" FOREIGN KEY ("form_submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_item_company_client_idx" ON "visit_item" USING btree ("company_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_item_log_once_idx" ON "visit_item_log" USING btree ("time_entry_id","item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_item_log_company_idx" ON "visit_item_log" USING btree ("company_id");