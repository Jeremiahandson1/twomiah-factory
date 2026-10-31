CREATE TABLE IF NOT EXISTS "project_budget_line" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"quote_id" text,
	"cost_code" text NOT NULL,
	"estimated_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"estimated_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"uncosted_lines" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE IF NOT EXISTS "project_template" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text,
	"from_project_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_template_punch_item" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"template_id" text NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_template_task" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"template_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"description" text,
	"offset_days" integer DEFAULT 0 NOT NULL,
	"span_days" integer DEFAULT 0 NOT NULL,
	"milestone" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "section" text;--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "markup_pct" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "allowance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "cost_code" text;--> statement-breakpoint
ALTER TABLE "inspection" ADD COLUMN IF NOT EXISTS "photos" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "project_selection" ADD COLUMN "quote_line_item_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_budget_line" ADD CONSTRAINT "project_budget_line_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_budget_line" ADD CONSTRAINT "project_budget_line_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_budget_line" ADD CONSTRAINT "project_budget_line_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
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
DO $$ BEGIN
 ALTER TABLE "project_template" ADD CONSTRAINT "project_template_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_template_punch_item" ADD CONSTRAINT "project_template_punch_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_template_punch_item" ADD CONSTRAINT "project_template_punch_item_template_id_project_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."project_template"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_template_task" ADD CONSTRAINT "project_template_task_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_template_task" ADD CONSTRAINT "project_template_task_template_id_project_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."project_template"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_budget_line_project_id_idx" ON "project_budget_line" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_budget_line_quote_id_idx" ON "project_budget_line" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_item_company_id_idx" ON "inspection_item" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_item_inspection_id_idx" ON "inspection_item" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_template_company_id_idx" ON "inspection_template" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inspection_template_company_id_name_idx" ON "inspection_template" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_template_item_template_id_idx" ON "inspection_template_item" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_template_company_id_idx" ON "project_template" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_template_company_id_name_idx" ON "project_template" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_template_punch_item_template_id_idx" ON "project_template_punch_item" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_template_task_template_id_idx" ON "project_template_task" USING btree ("template_id");